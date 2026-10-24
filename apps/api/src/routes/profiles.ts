import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@js/database";
import { DEVICE_PRESETS, describeDevicePreset } from "@js/browser-engine";
import { createBrowserProfileInput } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });

export async function browserProfileRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/browser-profiles/devices", async () => ({
    devices: DEVICE_PRESETS.map((d) => describeDevicePreset(d)).filter(Boolean),
    engines: await workerEngines(ctx),
  }));

  app.post("/browser-profiles", async (req, reply) => {
    const input = parse(createBrowserProfileInput, req.body);
    await requireProjectRole(req, input.projectId, "MEMBER");
    let isMobile = false;
    let userAgent: string | undefined;
    let { viewportWidth, viewportHeight } = input;
    if (input.devicePreset) {
      const d = describeDevicePreset(input.devicePreset);
      if (!d) throw new ApiError(400, "UNKNOWN_DEVICE", `Unknown device preset "${input.devicePreset}"`);
      isMobile = d.isMobile;
      userAgent = d.userAgent;
      viewportWidth = d.viewportWidth;
      viewportHeight = d.viewportHeight;
    }
    const profile = await prisma.browserProfile.create({
      data: { ...input, viewportWidth, viewportHeight, isMobile, userAgent },
    });
    await audit(req, "browser_profile.created", { projectId: input.projectId, targetType: "BrowserProfile", targetId: profile.id });
    return reply.status(201).send({ profile });
  });

  app.get("/browser-profiles", async (req) => {
    const { projectId } = parse(z.object({ projectId: z.string().min(1).max(64) }).passthrough(), req.query);
    await requireProjectRole(req, projectId);
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.browserProfile.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...page });
    return pageResult(rows, limit);
  });

  app.delete("/browser-profiles/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const p = await prisma.browserProfile.findUnique({ where: { id } });
    if (!p) throw notFound("Browser profile");
    await requireProjectRole(req, p.projectId, "MEMBER");
    await prisma.browserProfile.delete({ where: { id } });
    await audit(req, "browser_profile.deleted", { projectId: p.projectId, targetType: "BrowserProfile", targetId: id });
    return { ok: true };
  });
}

/** Engines reported by live workers (each worker refreshes its entry periodically). */
export async function workerEngines(ctx: AppContext): Promise<string[]> {
  const entries = await ctx.redis.hgetall("js:worker-engines").catch(() => ({}) as Record<string, string>);
  const engines = new Set<string>();
  const now = Date.now();
  for (const raw of Object.values(entries)) {
    try {
      const v = JSON.parse(raw) as { engines: string[]; at: number };
      if (now - v.at < 60_000) v.engines.forEach((e) => engines.add(e));
    } catch {
      /* ignore */
    }
  }
  return [...engines].sort();
}
