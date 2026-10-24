import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@js/database";
import { batchCounts, cancelBatch, cancelRun, dispatchBatch } from "@js/queue";
import { computeBatchStats } from "@js/reporting";
import { createBatchInput, IMPLEMENTED_SESSION_MODES, scenarioDefinitionSchema } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { checkScenarioTargets, loadAuthorizedHosts, type TargetIssue } from "../lib/authorization";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";
import { workerEngines } from "./profiles";

const idParams = z.object({ id: z.string().min(1).max(64) });

const runSummarySelect = {
  id: true,
  iteration: true,
  status: true,
  attempt: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  errorCategory: true,
  errorMessage: true,
  finalUrl: true,
} as const;

export async function batchRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/batches", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parse(createBatchInput, req.body);
    const scenario = await prisma.scenario.findUnique({ where: { id: input.scenarioId } });
    if (!scenario || scenario.archivedAt) throw notFound("Scenario");
    const membership = await requireProjectRole(req, scenario.projectId, "MEMBER");
    const project = await prisma.project.findUniqueOrThrow({ where: { id: scenario.projectId } });
    const limits = ctx.config.limits;
    const issues: TargetIssue[] = [];

    const version = await prisma.scenarioVersion.findUnique({
      where: { scenarioId_version: { scenarioId: scenario.id, version: input.scenarioVersion ?? scenario.latestVersion } },
    });
    if (!version) throw notFound("Scenario version");
    const parsed = scenarioDefinitionSchema.safeParse(version.definition);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((i) => ({ path: `definition.${i.path.join(".")}`, message: i.message })));
    }

    // Administrator-controlled limits.
    if (input.iterations > limits.maxIterationsPerBatch) {
      issues.push({ path: "iterations", message: `At most ${limits.maxIterationsPerBatch} iterations per batch (administrator limit)` });
    }
    if (input.concurrency > limits.maxConcurrencyPerBatch) {
      issues.push({ path: "concurrency", message: `At most ${limits.maxConcurrencyPerBatch} parallel browsers per batch (administrator limit)` });
    }
    if (input.launchDelayMs < limits.minLaunchDelayMs) {
      issues.push({ path: "launchDelayMs", message: `Launch delay must be at least ${limits.minLaunchDelayMs}ms` });
    }
    if (!IMPLEMENTED_SESSION_MODES.includes(input.sessionMode)) {
      issues.push({ path: "sessionMode", message: `${input.sessionMode} is not implemented yet; use FRESH_SESSION` });
    }
    const activeBatches = await prisma.testBatch.count({
      where: { projectId: scenario.projectId, status: { in: ["QUEUED", "RUNNING", "CANCELLING"] } },
    });
    if (!input.dryRun && activeBatches >= limits.maxActiveBatchesPerProject) {
      issues.push({ path: "project", message: `This project already has ${activeBatches} active batches (limit ${limits.maxActiveBatchesPerProject})` });
    }

    // Domain authorization + SSRF policy (DNS resolved now; re-checked by the worker before each run).
    if (parsed.success) {
      const hosts = await loadAuthorizedHosts(scenario.projectId);
      issues.push(...(await checkScenarioTargets(parsed.data, hosts, ctx.config.policy, true)));
    }

    const browserProfile = input.browserProfileId
      ? await prisma.browserProfile.findFirst({ where: { id: input.browserProfileId, projectId: scenario.projectId } })
      : null;
    if (input.browserProfileId && !browserProfile) issues.push({ path: "browserProfileId", message: "Browser profile not found in this project" });
    const engines = await workerEngines(ctx);
    const engine = browserProfile?.engine ?? "chromium";
    if (engines.length > 0 && !engines.includes(engine)) {
      issues.push({ path: "browserProfileId", message: `No connected worker has the ${engine} browser installed (available: ${engines.join(", ")})` });
    }
    const proxy = input.proxyProfileId
      ? await prisma.proxyProfile.findFirst({ where: { id: input.proxyProfileId, projectId: scenario.projectId } })
      : null;
    if (input.proxyProfileId && !proxy) issues.push({ path: "proxyProfileId", message: "Proxy profile not found in this project" });

    if (input.dryRun) {
      return {
        dryRun: true,
        valid: issues.length === 0,
        issues,
        plan: {
          scenarioVersion: version.version,
          iterations: input.iterations,
          concurrency: input.concurrency,
          engine,
          proxy: proxy ? `${proxy.name} (${proxy.host}:${proxy.port})` : null,
          workersOnline: engines.length > 0,
        },
      };
    }
    if (issues.length) throw new ApiError(422, "BATCH_REJECTED", "The batch configuration is not valid", issues);

    const targetHost = new URL(version.startUrl).hostname;
    const configSnapshot = {
      browserProfile: browserProfile
        ? {
            id: browserProfile.id,
            name: browserProfile.name,
            engine: browserProfile.engine,
            devicePreset: browserProfile.devicePreset,
            viewportWidth: browserProfile.viewportWidth,
            viewportHeight: browserProfile.viewportHeight,
            isMobile: browserProfile.isMobile,
            userAgent: browserProfile.userAgent,
            locale: browserProfile.locale,
            timezone: browserProfile.timezone,
            colorScheme: browserProfile.colorScheme,
          }
        : null,
      proxy: proxy
        ? { id: proxy.id, name: proxy.name, type: proxy.type, host: proxy.host, port: proxy.port, regionLabel: proxy.regionLabel, hasCredentials: proxy.hasCredentials }
        : null,
      sessionMode: input.sessionMode,
      testHeader: project.testHeaderEnabled ? { name: project.testHeaderName, value: project.testHeaderValue } : null,
    };

    const batch = await prisma.testBatch.create({
      data: {
        projectId: scenario.projectId,
        scenarioId: scenario.id,
        scenarioVersionId: version.id,
        browserProfileId: browserProfile?.id,
        proxyProfileId: proxy?.id,
        sessionMode: input.sessionMode,
        createdById: membership.userId,
        iterations: input.iterations,
        concurrency: input.concurrency,
        launchDelayMs: input.launchDelayMs,
        maxFailures: input.maxFailures,
        captureTrace: input.captureTrace,
        configSnapshot: configSnapshot as unknown as Prisma.InputJsonValue,
        runs: { createMany: { data: Array.from({ length: input.iterations }, (_, i) => ({ iteration: i + 1, targetHost })) } },
      },
    });
    await audit(req, "batch.created", {
      projectId: scenario.projectId,
      targetType: "TestBatch",
      targetId: batch.id,
      metadata: { scenarioId: scenario.id, version: version.version, iterations: input.iterations, concurrency: input.concurrency },
    });
    await dispatchBatch(batch.id, { queues: ctx.queues, redis: ctx.redis, limits });
    return reply.status(201).send({ batch });
  });

  app.get("/batches", async (req) => {
    const q = parse(z.object({ projectId: z.string().min(1).max(64), scenarioId: z.string().max(64).optional() }).passthrough(), req.query);
    await requireProjectRole(req, q.projectId);
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.testBatch.findMany({
      where: { projectId: q.projectId, ...(q.scenarioId ? { scenarioId: q.scenarioId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...page,
      include: { scenario: { select: { name: true } }, scenarioVersion: { select: { version: true } } },
    });
    const { items, nextCursor } = pageResult(rows, limit);
    const withCounts = await Promise.all(items.map(async (b) => ({ ...b, counts: await batchCounts(prisma, b.id) })));
    return { items: withCounts, nextCursor };
  });

  app.get("/batches/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const batch = await prisma.testBatch.findUnique({
      where: { id },
      include: {
        scenario: { select: { id: true, name: true } },
        scenarioVersion: { select: { version: true, startUrl: true } },
        createdBy: { select: { email: true } },
      },
    });
    if (!batch) throw notFound("Batch");
    await requireProjectRole(req, batch.projectId);
    const runs = await prisma.testRun.findMany({ where: { batchId: id }, select: { status: true, durationMs: true } });
    return { batch, counts: await batchCounts(prisma, id), stats: computeBatchStats(runs) };
  });

  app.get("/batches/:id/runs", async (req) => {
    const { id } = parse(idParams, req.params);
    const batch = await prisma.testBatch.findUnique({ where: { id }, select: { projectId: true } });
    if (!batch) throw notFound("Batch");
    await requireProjectRole(req, batch.projectId);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).passthrough(), req.query);
    const [items, total] = await Promise.all([
      prisma.testRun.findMany({ where: { batchId: id }, orderBy: { iteration: "asc" }, skip: q.offset, take: q.limit, select: runSummarySelect }),
      prisma.testRun.count({ where: { batchId: id } }),
    ]);
    return { items, total };
  });

  app.post("/batches/:id/cancel", async (req) => {
    const { id } = parse(idParams, req.params);
    const batch = await prisma.testBatch.findUnique({ where: { id }, select: { projectId: true } });
    if (!batch) throw notFound("Batch");
    await requireProjectRole(req, batch.projectId, "MEMBER");
    const result = await cancelBatch(id, `Cancelled by ${req.user!.email}`, { redis: ctx.redis });
    if (!result.cancelled) throw new ApiError(409, "NOT_CANCELLABLE", "This batch has already finished");
    await audit(req, "batch.cancelled", { projectId: batch.projectId, targetType: "TestBatch", targetId: id });
    return { ok: true, ...result };
  });

  app.post("/runs/:id/cancel", async (req) => {
    const { id } = parse(idParams, req.params);
    const run = await prisma.testRun.findUnique({ where: { id }, select: { batch: { select: { projectId: true } } } });
    if (!run) throw notFound("Run");
    await requireProjectRole(req, run.batch.projectId, "MEMBER");
    const result = await cancelRun(id, `Cancelled by ${req.user!.email}`, { redis: ctx.redis });
    if (!result.cancelled) throw new ApiError(409, "NOT_CANCELLABLE", "This run has already finished");
    await audit(req, "run.cancelled", { projectId: run.batch.projectId, targetType: "TestRun", targetId: id });
    return { ok: true };
  });
}
