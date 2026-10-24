import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@js/database";
import { requireProjectRole } from "../lib/access";
import { notFound, parse } from "../lib/errors";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });

const artifactSelect = { id: true, kind: true, contentType: true, sizeBytes: true, stepResultId: true, createdAt: true, expiresAt: true } as const;

async function loadRunForUser(req: Parameters<typeof requireProjectRole>[0], id: string) {
  const run = await prisma.testRun.findUnique({
    where: { id },
    include: {
      batch: {
        select: {
          id: true,
          projectId: true,
          configSnapshot: true,
          captureTrace: true,
          scenario: { select: { id: true, name: true } },
          scenarioVersion: { select: { version: true, startUrl: true } },
        },
      },
    },
  });
  if (!run) throw notFound("Run");
  await requireProjectRole(req, run.batch.projectId);
  return run;
}

export async function runRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/runs/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const { workerId: _w, ...run } = await loadRunForUser(req, id);
    return { run };
  });

  app.get("/runs/:id/steps", async (req) => {
    const { id } = parse(idParams, req.params);
    await loadRunForUser(req, id);
    const steps = await prisma.stepResult.findMany({
      where: { runId: id },
      orderBy: { stepIndex: "asc" },
      include: { artifacts: { select: artifactSelect } },
    });
    return { items: steps };
  });

  app.get("/runs/:id/artifacts", async (req) => {
    const { id } = parse(idParams, req.params);
    await loadRunForUser(req, id);
    const items = await prisma.artifact.findMany({ where: { runId: id }, orderBy: { createdAt: "asc" }, select: artifactSelect });
    return { items };
  });

  /** Streams an artifact after checking project access. Storage keys are never exposed. */
  app.get("/artifacts/:id/content", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const artifact = await prisma.artifact.findUnique({ where: { id }, include: { run: { select: { batch: { select: { projectId: true } } } } } });
    if (!artifact) throw notFound("Artifact");
    await requireProjectRole(req, artifact.run.batch.projectId);
    const stream = await ctx.storage.getStream(artifact.storageKey).catch(() => null);
    if (!stream) throw notFound("Artifact content");
    const download = artifact.kind === "TRACE";
    reply
      .header("content-type", artifact.contentType)
      .header("cache-control", "private, max-age=300")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", download ? `attachment; filename="trace-${artifact.runId}.zip"` : "inline");
    return reply.send(stream);
  });
}
