/**
 * BullMQ dispatch, idempotency, failure thresholds and stale-run recovery.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { prisma } from "@js/database";
import { cancelBatch, createQueues, dispatchBatch, enqueueRun, redisConnection, type Queues, type Redis } from "@js/queue";
import { DEFAULT_LIMITS } from "@js/shared";
import { recoverStaleRuns } from "../../apps/worker/src/executor";
import { resetDatabase } from "../setup/helpers";

let redis: Redis;
let queues: Queues;
const limits = { ...DEFAULT_LIMITS, maxActiveRunsSystem: 100, maxActiveRunsPerDomain: 100, maxConcurrencyPerBatch: 10 };
const logger = pino({ level: "silent" });

async function makeBatch(opts: { iterations: number; concurrency: number; launchDelayMs?: number; maxFailures?: number; host?: string }) {
  const project = await prisma.project.create({ data: { name: "p" } });
  const scenario = await prisma.scenario.create({
    data: {
      projectId: project.id,
      name: "s",
      versions: { create: { version: 1, startUrl: "http://localhost:1/", definition: { startUrl: "http://localhost:1/", steps: [] } } },
    },
    include: { versions: true },
  });
  return prisma.testBatch.create({
    data: {
      projectId: project.id,
      scenarioId: scenario.id,
      scenarioVersionId: scenario.versions[0]!.id,
      iterations: opts.iterations,
      concurrency: opts.concurrency,
      launchDelayMs: opts.launchDelayMs ?? 0,
      maxFailures: opts.maxFailures ?? 0,
      configSnapshot: {},
      runs: { createMany: { data: Array.from({ length: opts.iterations }, (_, i) => ({ iteration: i + 1, targetHost: opts.host ?? "localhost" })) } },
    },
  });
}
const statuses = async (batchId: string) =>
  (await prisma.testRun.findMany({ where: { batchId }, orderBy: { iteration: "asc" } })).map((r) => r.status);

beforeAll(async () => {
  redis = redisConnection(process.env.REDIS_URL);
  queues = createQueues(redisConnection(process.env.REDIS_URL), "jstest");
});
afterAll(async () => {
  await queues.close();
  await redis.quit();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  await redis.flushdb();
});

describe("dispatchBatch", () => {
  it("never exceeds batch concurrency, even when called concurrently", async () => {
    const b = await makeBatch({ iterations: 10, concurrency: 3 });
    await Promise.all(Array.from({ length: 8 }, () => dispatchBatch(b.id, { queues, limits })));
    expect((await statuses(b.id)).filter((s) => s === "DISPATCHED")).toHaveLength(3);
    expect(await queues.runs.count()).toBe(3);
  });

  it("dispatches the next run when a slot frees up", async () => {
    const b = await makeBatch({ iterations: 3, concurrency: 1 });
    await dispatchBatch(b.id, { queues, limits });
    expect(await statuses(b.id)).toEqual(["DISPATCHED", "QUEUED", "QUEUED"]);
    await prisma.testRun.updateMany({ where: { batchId: b.id, iteration: 1 }, data: { status: "PASSED" } });
    await dispatchBatch(b.id, { queues, limits });
    expect(await statuses(b.id)).toEqual(["PASSED", "DISPATCHED", "QUEUED"]);
  });

  it("is idempotent at the queue level (jobId = runId)", async () => {
    const b = await makeBatch({ iterations: 1, concurrency: 1 });
    await dispatchBatch(b.id, { queues, limits });
    const run = await prisma.testRun.findFirstOrThrow({ where: { batchId: b.id } });
    await enqueueRun(queues, run.id);
    await enqueueRun(queues, run.id);
    expect(await queues.runs.count()).toBe(1);
  });

  it("spaces launches by the configured delay", async () => {
    const b = await makeBatch({ iterations: 3, concurrency: 3, launchDelayMs: 2000 });
    await dispatchBatch(b.id, { queues, limits });
    const jobs = await queues.runs.getJobs(["waiting", "delayed"]);
    const delays = jobs.map((j) => j.opts.delay ?? 0).sort((a, b) => a - b);
    expect(delays[0]).toBeLessThan(200);
    expect(delays[1]).toBeGreaterThanOrEqual(1800);
    expect(delays[2]).toBeGreaterThanOrEqual(3800);
  });

  it("respects per-domain and system-wide limits", async () => {
    const a = await makeBatch({ iterations: 5, concurrency: 5, host: "shop.test" });
    const b = await makeBatch({ iterations: 5, concurrency: 5, host: "shop.test" });
    const tight = { ...limits, maxActiveRunsPerDomain: 3 };
    await dispatchBatch(a.id, { queues, limits: tight });
    await dispatchBatch(b.id, { queues, limits: tight });
    expect(await prisma.testRun.count({ where: { status: "DISPATCHED" } })).toBe(3);
    const c = await makeBatch({ iterations: 5, concurrency: 5, host: "other.test" });
    await dispatchBatch(c.id, { queues, limits: { ...limits, maxActiveRunsSystem: 4 } });
    expect(await prisma.testRun.count({ where: { status: "DISPATCHED" } })).toBe(4);
  });

  it("stops at the failure threshold and marks the batch FAILED", async () => {
    const b = await makeBatch({ iterations: 5, concurrency: 2, maxFailures: 2 });
    await dispatchBatch(b.id, { queues, limits });
    await prisma.testRun.updateMany({ where: { batchId: b.id, status: "DISPATCHED" }, data: { status: "FAILED" } });
    await dispatchBatch(b.id, { queues, limits });
    expect(await statuses(b.id)).toEqual(["FAILED", "FAILED", "CANCELLED", "CANCELLED", "CANCELLED"]);
    const batch = await prisma.testBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(batch.status).toBe("FAILED");
    expect(batch.cancelReason).toMatch(/Failure threshold/);
  });

  it("completes the batch when all runs are finished", async () => {
    const b = await makeBatch({ iterations: 2, concurrency: 2 });
    await prisma.testRun.updateMany({ where: { batchId: b.id }, data: { status: "PASSED" } });
    const r = await dispatchBatch(b.id, { queues, limits });
    expect(r.finalized).toBe(true);
    expect((await prisma.testBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("COMPLETED");
  });
});

describe("cancellation", () => {
  it("cancels queued runs, flags running ones, and signals workers", async () => {
    const b = await makeBatch({ iterations: 3, concurrency: 3 });
    await dispatchBatch(b.id, { queues, limits });
    await prisma.testRun.updateMany({ where: { batchId: b.id, iteration: 1 }, data: { status: "RUNNING" } });
    const sub = redisConnection(process.env.REDIS_URL);
    const received = new Promise<string>((resolve) => sub.on("message", (_c, m) => resolve(m)));
    await sub.subscribe("journey:cancel");
    const r = await cancelBatch(b.id, "test", { redis });
    expect(r).toMatchObject({ cancelled: true, signalledRuns: 1 });
    expect(JSON.parse(await received).runIds).toHaveLength(1);
    await sub.quit();
    const runs = await prisma.testRun.findMany({ where: { batchId: b.id }, orderBy: { iteration: "asc" } });
    expect(runs.map((x) => x.status)).toEqual(["RUNNING", "CANCELLED", "CANCELLED"]);
    expect(runs[0]!.cancelRequested).toBe(true);
    // Not finalized while a run is still stopping.
    expect((await prisma.testBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLING");
    await prisma.testRun.updateMany({ where: { batchId: b.id, iteration: 1 }, data: { status: "CANCELLED" } });
    await dispatchBatch(b.id, { queues, limits });
    expect((await prisma.testBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
  });
});

describe("stale-run recovery", () => {
  it("requeues runs whose worker stopped heartbeating, with bounded attempts", async () => {
    const b = await makeBatch({ iterations: 2, concurrency: 2 });
    const old = new Date(Date.now() - 10 * 60_000);
    const [r1, r2] = await prisma.testRun.findMany({ where: { batchId: b.id }, orderBy: { iteration: "asc" } });
    await prisma.testRun.update({ where: { id: r1!.id }, data: { status: "RUNNING", heartbeatAt: old, attempt: 1 } });
    await prisma.testRun.update({ where: { id: r2!.id }, data: { status: "RUNNING", heartbeatAt: old, attempt: 2 } });
    const result = await recoverStaleRuns({ staleAfterMs: 60_000, maxAttempts: 2, reenqueue: async () => undefined, logger });
    expect(result).toMatchObject({ requeued: 1, failed: 1 });
    const runs = await prisma.testRun.findMany({ where: { batchId: b.id }, orderBy: { iteration: "asc" } });
    expect(runs[0]!.status).toBe("QUEUED");
    expect(runs[1]!.status).toBe("FAILED");
    expect(runs[1]!.errorCategory).toBe("INFRASTRUCTURE");
  });

  it("re-enqueues dispatched runs whose job went missing", async () => {
    const b = await makeBatch({ iterations: 1, concurrency: 1 });
    const run = await prisma.testRun.findFirstOrThrow({ where: { batchId: b.id } });
    await prisma.testRun.update({ where: { id: run.id }, data: { status: "DISPATCHED", dispatchedAt: new Date(Date.now() - 600_000) } });
    const seen: string[] = [];
    await recoverStaleRuns({ staleAfterMs: 60_000, maxAttempts: 2, reenqueue: async (id) => void seen.push(id), logger });
    expect(seen).toEqual([run.id]);
  });
});
