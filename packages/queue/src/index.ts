import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { prisma, Prisma, type PrismaClient } from "@js/database";
import {
  QUEUE_NAMES,
  REDIS_CHANNELS,
  type BatchCounts,
  type BatchStatus,
  type PlatformEvent,
  type PlatformLimits,
  type ProxyTestJobData,
  type ProxyTestResult,
  type RunJobData,
} from "@js/shared";

export function redisConnection(url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"): Redis {
  // BullMQ requires maxRetriesPerRequest: null on blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

export interface Queues {
  runs: Queue<RunJobData>;
  proxyTests: Queue<ProxyTestJobData, ProxyTestResult>;
  proxyTestEvents: QueueEvents;
  close(): Promise<void>;
}

export function createQueues(connection: ConnectionOptions, prefix = process.env.QUEUE_PREFIX ?? "js"): Queues {
  const runs = new Queue<RunJobData>(QUEUE_NAMES.runs, { connection, prefix });
  const proxyTests = new Queue<ProxyTestJobData, ProxyTestResult>(QUEUE_NAMES.proxyTests, { connection, prefix });
  const proxyTestEvents = new QueueEvents(QUEUE_NAMES.proxyTests, { connection, prefix });
  return {
    runs,
    proxyTests,
    proxyTestEvents,
    async close() {
      await Promise.allSettled([runs.close(), proxyTests.close(), proxyTestEvents.close()]);
    },
  };
}

// ---------------------------------------------------------------------------
// Event bus (Redis pub/sub → SSE)
// ---------------------------------------------------------------------------

export async function publishEvent(redis: Redis, event: PlatformEvent): Promise<void> {
  await redis.publish(REDIS_CHANNELS.events, JSON.stringify(event)).catch(() => undefined);
}

export async function publishCancel(redis: Redis, runIds: string[]): Promise<void> {
  if (runIds.length) await redis.publish(REDIS_CHANNELS.cancel, JSON.stringify({ runIds }));
}

// ---------------------------------------------------------------------------
// Batch dispatcher
// ---------------------------------------------------------------------------

const ACTIVE = ["DISPATCHED", "RUNNING"] as const;
const TERMINAL_BATCH: BatchStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export async function batchCounts(db: PrismaClient | Prisma.TransactionClient, batchId: string): Promise<BatchCounts> {
  const grouped = await db.testRun.groupBy({ by: ["status"], where: { batchId }, _count: { _all: true } });
  const c = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return {
    total: grouped.reduce((n, g) => n + g._count._all, 0),
    queued: c("QUEUED") + c("DISPATCHED"),
    running: c("RUNNING"),
    passed: c("PASSED"),
    failed: c("FAILED") + c("TIMED_OUT"),
    cancelled: c("CANCELLED"),
  };
}

export interface DispatchDeps {
  db?: PrismaClient;
  queues: Pick<Queues, "runs">;
  redis?: Redis;
  limits: PlatformLimits;
  now?: () => Date;
}

/**
 * Move queued runs of a batch into the BullMQ queue, respecting batch
 * concurrency, launch delay, failure thresholds and per-domain / system-wide
 * limits. Safe to call concurrently from any process: a transaction-scoped
 * Postgres advisory lock serializes dispatching per batch.
 */
export async function dispatchBatch(batchId: string, deps: DispatchDeps): Promise<{ dispatched: number; finalized: boolean }> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? (() => new Date());
  const toEnqueue: Array<{ runId: string; delay: number }> = [];

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch:${batchId}`}))`;
    const batch = await tx.testBatch.findUnique({ where: { id: batchId } });
    if (!batch || TERMINAL_BATCH.includes(batch.status as BatchStatus)) return { finalized: false };

    const counts = await batchCounts(tx, batchId);

    // Failure threshold → stop dispatching and cancel what is still queued.
    if (batch.status !== "CANCELLING" && batch.maxFailures > 0 && counts.failed >= batch.maxFailures) {
      await tx.testRun.updateMany({
        where: { batchId, status: { in: ["QUEUED", "DISPATCHED"] } },
        data: { status: "CANCELLED", errorCategory: "CANCELLED", errorMessage: "Batch failure threshold reached", finishedAt: now() },
      });
      await tx.testBatch.update({
        where: { id: batchId },
        data: { status: "CANCELLING", cancelReason: `Failure threshold reached (${counts.failed} failed runs)` },
      });
      batch.status = "CANCELLING";
    }

    if (batch.status === "CANCELLING") return { finalized: await finalizeIfDone(tx, batchId, now) };

    const active = await tx.testRun.count({ where: { batchId, status: { in: [...ACTIVE] } } });
    let slots = batch.concurrency - active;
    if (slots > 0) {
      const systemActive = await tx.testRun.count({ where: { status: { in: [...ACTIVE] } } });
      slots = Math.min(slots, deps.limits.maxActiveRunsSystem - systemActive);
    }
    if (slots > 0) {
      const sample = await tx.testRun.findFirst({ where: { batchId, status: "QUEUED" }, select: { targetHost: true } });
      if (sample) {
        const domainActive = await tx.testRun.count({ where: { targetHost: sample.targetHost, status: { in: [...ACTIVE] } } });
        slots = Math.min(slots, deps.limits.maxActiveRunsPerDomain - domainActive);
      }
    }
    if (slots <= 0) return { finalized: await finalizeIfDone(tx, batchId, now) };

    const next = await tx.testRun.findMany({
      where: { batchId, status: "QUEUED" },
      orderBy: { iteration: "asc" },
      take: slots,
      select: { id: true },
    });
    if (next.length === 0) return { finalized: await finalizeIfDone(tx, batchId, now) };

    let launchAt = Math.max(now().getTime(), batch.nextLaunchAt?.getTime() ?? 0);
    for (const run of next) {
      toEnqueue.push({ runId: run.id, delay: Math.max(0, launchAt - now().getTime()) });
      launchAt += batch.launchDelayMs;
    }
    await tx.testRun.updateMany({
      where: { id: { in: next.map((r) => r.id) }, status: "QUEUED" },
      data: { status: "DISPATCHED", dispatchedAt: now() },
    });
    await tx.testBatch.update({ where: { id: batchId }, data: { nextLaunchAt: new Date(launchAt) } });
    return { finalized: false };
  });

  // Enqueue after commit. jobId = runId makes this idempotent; if it fails the
  // stale-dispatch recovery re-enqueues the run.
  for (const j of toEnqueue) await enqueueRun(deps.queues, j.runId, j.delay);

  if (deps.redis) {
    const batch = await db.testBatch.findUnique({ where: { id: batchId }, select: { projectId: true, status: true } });
    if (batch) {
      await publishEvent(deps.redis, {
        type: "batch.updated",
        projectId: batch.projectId,
        batchId,
        status: batch.status as BatchStatus,
        counts: await batchCounts(db, batchId),
      });
    }
  }
  return { dispatched: toEnqueue.length, finalized: result.finalized };
}

export async function enqueueRun(queues: Pick<Queues, "runs">, runId: string, delay = 0) {
  await queues.runs.add(
    "run",
    { runId },
    { jobId: runId, delay, attempts: 1, removeOnComplete: { count: 5000 }, removeOnFail: { count: 5000 } },
  );
}

/** Mark the batch finished when nothing is queued or running. */
export async function finalizeIfDone(tx: Prisma.TransactionClient, batchId: string, now: () => Date = () => new Date()): Promise<boolean> {
  const remaining = await tx.testRun.count({ where: { batchId, status: { in: ["QUEUED", "DISPATCHED", "RUNNING"] } } });
  if (remaining > 0) return false;
  const batch = await tx.testBatch.findUnique({ where: { id: batchId }, select: { status: true, cancelReason: true } });
  if (!batch || TERMINAL_BATCH.includes(batch.status as BatchStatus)) return false;
  let status: BatchStatus = "COMPLETED";
  if (batch.status === "CANCELLING") status = batch.cancelReason?.startsWith("Failure threshold") ? "FAILED" : "CANCELLED";
  await tx.testBatch.update({ where: { id: batchId }, data: { status, finishedAt: now() } });
  return true;
}

/**
 * Cancel a batch: queued runs are cancelled immediately, running runs are
 * flagged and signalled; workers stop them at the current step.
 */
export async function cancelBatch(batchId: string, reason: string, deps: { db?: PrismaClient; redis: Redis }) {
  const db = deps.db ?? prisma;
  const running = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch:${batchId}`}))`;
    const batch = await tx.testBatch.findUnique({ where: { id: batchId } });
    if (!batch || TERMINAL_BATCH.includes(batch.status as BatchStatus)) return null;
    await tx.testBatch.update({ where: { id: batchId }, data: { status: "CANCELLING", cancelReason: reason } });
    await tx.testRun.updateMany({
      where: { batchId, status: { in: ["QUEUED", "DISPATCHED"] } },
      data: { status: "CANCELLED", errorCategory: "CANCELLED", errorMessage: reason, finishedAt: new Date() },
    });
    const runs = await tx.testRun.findMany({ where: { batchId, status: "RUNNING" }, select: { id: true } });
    await tx.testRun.updateMany({ where: { batchId, status: "RUNNING" }, data: { cancelRequested: true } });
    await finalizeIfDone(tx, batchId);
    return runs.map((r) => r.id);
  });
  if (running === null) return { cancelled: false };
  await publishCancel(deps.redis, running);
  const batch = await db.testBatch.findUnique({ where: { id: batchId }, select: { projectId: true, status: true } });
  if (batch) {
    await publishEvent(deps.redis, {
      type: "batch.updated",
      projectId: batch.projectId,
      batchId,
      status: batch.status as BatchStatus,
      counts: await batchCounts(db, batchId),
    });
  }
  return { cancelled: true, signalledRuns: running.length };
}

/** Cancel a single run (step-level stop for running runs). */
export async function cancelRun(runId: string, reason: string, deps: { db?: PrismaClient; redis: Redis }) {
  const db = deps.db ?? prisma;
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { status: true, batchId: true } });
  if (!run) return { cancelled: false };
  if (run.status === "QUEUED" || run.status === "DISPATCHED") {
    const r = await db.testRun.updateMany({
      where: { id: runId, status: { in: ["QUEUED", "DISPATCHED"] } },
      data: { status: "CANCELLED", errorCategory: "CANCELLED", errorMessage: reason, finishedAt: new Date() },
    });
    await db.$transaction((tx) => finalizeIfDone(tx, run.batchId));
    return { cancelled: r.count > 0 };
  }
  if (run.status === "RUNNING") {
    await db.testRun.update({ where: { id: runId }, data: { cancelRequested: true } });
    await publishCancel(deps.redis, [runId]);
    return { cancelled: true };
  }
  return { cancelled: false };
}

export { Queue, QueueEvents, Redis };
