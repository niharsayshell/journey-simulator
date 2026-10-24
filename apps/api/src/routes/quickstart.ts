import type { FastifyInstance } from "fastify";
import { prisma } from "@js/database";
import { quickStartInput, scenarioDefinitionSchema } from "@js/shared";
import { safeFetchText, type NetworkPolicy } from "@js/security";
import { requireUser } from "../lib/access";
import { audit } from "../lib/audit";
import { parse } from "../lib/errors";
import type { AppContext } from "../lib/context";
import { createDomain } from "./domains";
import { projectSelect } from "./projects";
import { versionData } from "./scenarios";

/**
 * One-step onboarding: from a website URL, create a project, authorize the
 * site on the user's declaration of ownership/permission, and save a starter
 * scenario that the user can run or edit straight away.
 */
export async function quickStartRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/quick-start", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const input = parse(quickStartInput, req.body);
    const url = await resolveScheme(input.url, ctx.config.policy);
    url.hash = "";
    const scheme = url.protocol === "http:" ? "http" : "https";
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;

    const project = await prisma.project.create({
      data: {
        name: input.projectName || url.hostname,
        memberships: { create: { userId: user.id, role: "OWNER" } },
        browserProfiles: { create: { name: "Desktop Chrome (default)", engine: "chromium", devicePreset: "Desktop Chrome" } },
      },
      select: projectSelect,
    });
    try {
      const domain = await createDomain(req, ctx, {
        projectId: project.id,
        host,
        method: "SELF_ATTESTED",
        scheme,
        allowSubdomains: false,
        attestation: input.attestation,
      });
      const definition = scenarioDefinitionSchema.parse({
        startUrl: url.toString(),
        steps: [
          { id: "open", type: "NAVIGATE", url: url.toString(), label: "Open the website" },
          { id: "read", type: "WAIT", durationMs: 1000, randomMaxMs: 3000, label: "Pause like a visitor" },
          { id: "scroll", type: "SCROLL", deltaY: 1200, steps: 4, label: "Scroll down the page" },
          { id: "shot", type: "SCREENSHOT", label: "Capture the page" },
        ],
      });
      const scenario = await prisma.scenario.create({
        data: {
          projectId: project.id,
          name: `Visit ${url.hostname}`,
          description: "Starter journey created by Quick start. Add clicks, typing and checks in the editor.",
          versions: { create: versionData(definition, 1, user.id, "Created by Quick start") },
        },
      });
      await audit(req, "project.quick_start", {
        projectId: project.id,
        targetType: "Project",
        targetId: project.id,
        metadata: { url: url.origin, domainId: domain.id, scenarioId: scenario.id },
      });
      return reply.status(201).send({ project: { ...project, role: "OWNER" }, domainId: domain.id, scenarioId: scenario.id });
    } catch (err) {
      // Leave nothing half-created behind.
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      throw err;
    }
  });
}

/**
 * Users often type "shop.example.com" without a scheme. Try https first and
 * fall back to http only when https is unreachable but http answers.
 */
async function resolveScheme(raw: string, policy: NetworkPolicy): Promise<URL> {
  if (/^https?:\/\//i.test(raw)) return new URL(raw);
  const https = new URL(`https://${raw}`);
  const http = new URL(`http://${raw}`);
  const reachable = (u: URL) =>
    safeFetchText(u.toString(), policy, { timeoutMs: 5000, maxBytes: 1 }).then(
      () => true,
      () => false,
    );
  if (await reachable(https)) return https;
  if (await reachable(http)) return http;
  return https;
}
