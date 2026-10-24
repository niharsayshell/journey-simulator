import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@js/database";
import { createScenarioInput, updateScenarioInput, type ScenarioDefinition } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { checkScenarioTargets, loadAuthorizedHosts } from "../lib/authorization";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });

export function versionData(def: ScenarioDefinition, version: number, userId: string, changeNote?: string) {
  return {
    version,
    definition: def as unknown as Prisma.InputJsonValue,
    startUrl: def.startUrl,
    changeNote,
    createdById: userId,
    steps: {
      create: def.steps.map((s, index) => ({
        index,
        stepKey: s.id,
        type: s.type,
        label: s.label,
        config: s as unknown as Prisma.InputJsonValue,
      })),
    },
  };
}

async function assertTargetsAuthorized(projectId: string, def: ScenarioDefinition, ctx: AppContext) {
  const hosts = await loadAuthorizedHosts(projectId);
  const issues = await checkScenarioTargets(def, hosts, ctx.config.policy, false);
  if (issues.length) {
    throw new ApiError(422, "UNAUTHORIZED_TARGET", "The scenario navigates to domains that are not verified for this project", issues);
  }
}

export async function scenarioRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/scenarios", async (req, reply) => {
    const input = parse(createScenarioInput, req.body);
    const m = await requireProjectRole(req, input.projectId, "MEMBER");
    await assertTargetsAuthorized(input.projectId, input.definition, ctx);
    const scenario = await prisma.scenario.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        latestVersion: 1,
        versions: { create: versionData(input.definition, 1, m.userId, "Initial version") },
      },
    });
    await audit(req, "scenario.created", { projectId: input.projectId, targetType: "Scenario", targetId: scenario.id });
    return reply.status(201).send({ scenario: { ...scenario, definition: input.definition } });
  });

  app.get("/scenarios", async (req) => {
    const q = parse(z.object({ projectId: z.string().min(1).max(64), search: z.string().max(100).optional() }).passthrough(), req.query);
    await requireProjectRole(req, q.projectId);
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.scenario.findMany({
      where: { projectId: q.projectId, archivedAt: null, ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...page,
      include: {
        versions: { orderBy: { version: "desc" }, take: 1, select: { startUrl: true, version: true, _count: { select: { steps: true } } } },
        batches: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, createdAt: true } },
      },
    });
    const { items, nextCursor } = pageResult(rows, limit);
    return {
      items: items.map(({ versions, batches, ...s }) => ({
        ...s,
        startUrl: versions[0]?.startUrl,
        stepCount: versions[0]?._count.steps ?? 0,
        lastBatch: batches[0] ?? null,
      })),
      nextCursor,
    };
  });

  app.get("/scenarios/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const q = parse(z.object({ version: z.coerce.number().int().min(1).optional() }).passthrough(), req.query);
    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario) throw notFound("Scenario");
    await requireProjectRole(req, scenario.projectId);
    const version = await prisma.scenarioVersion.findUnique({
      where: { scenarioId_version: { scenarioId: id, version: q.version ?? scenario.latestVersion } },
    });
    if (!version) throw notFound("Scenario version");
    const versions = await prisma.scenarioVersion.findMany({
      where: { scenarioId: id },
      orderBy: { version: "desc" },
      select: { version: true, changeNote: true, createdAt: true },
      take: 50,
    });
    return { scenario: { ...scenario, version: version.version, definition: version.definition }, versions };
  });

  app.put("/scenarios/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateScenarioInput, req.body);
    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario || scenario.archivedAt) throw notFound("Scenario");
    const m = await requireProjectRole(req, scenario.projectId, "MEMBER");

    let latestVersion = scenario.latestVersion;
    if (input.definition) {
      await assertTargetsAuthorized(scenario.projectId, input.definition, ctx);
      const current = await prisma.scenarioVersion.findUnique({
        where: { scenarioId_version: { scenarioId: id, version: scenario.latestVersion } },
        select: { definition: true },
      });
      // Only create a version when the definition actually changed.
      if (JSON.stringify(current?.definition) !== JSON.stringify(input.definition)) latestVersion += 1;
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (input.definition && latestVersion !== scenario.latestVersion) {
        await tx.scenarioVersion.create({ data: { scenarioId: id, ...versionData(input.definition, latestVersion, m.userId, input.changeNote) } });
      }
      return tx.scenario.update({
        where: { id, latestVersion: scenario.latestVersion }, // optimistic concurrency
        data: { name: input.name, description: input.description, latestVersion },
      });
    });
    await audit(req, "scenario.updated", { projectId: scenario.projectId, targetType: "Scenario", targetId: id, metadata: { version: latestVersion } });
    return { scenario: updated };
  });

  app.delete("/scenarios/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario) throw notFound("Scenario");
    await requireProjectRole(req, scenario.projectId, "MEMBER");
    await prisma.scenario.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(req, "scenario.archived", { projectId: scenario.projectId, targetType: "Scenario", targetId: id });
    return { ok: true };
  });
}
