import { Worker } from "bullmq";
import pino from "pino";
import { prisma } from "@js/database";
import { availableEngines } from "@js/browser-engine";
import { createQueues, dispatchBatch, enqueueRun, redisConnection } from "@js/queue";
import { QUEUE_NAMES, REDIS_CHANNELS, type ProxyTestJobData, type ProxyTestResult, type RunJobData } from "@js/shared";
import { createStorageFromEnv } from "@js/storage";
import { loadWorkerConfig } from "./config";
import { activeRuns, executeRun, recoverStaleRuns, WORKER_SHUTDOWN } from "./executor";
import { runProxyTest } from "./proxy-test";

const config = loadWorkerConfig();
const logger = pino({ level: config.logLevel, base: { service: "worker", workerId: config.workerId } });
const prefix = process.env.QUEUE_PREFIX ?? "js";

const connection = redisConnection(config.redisUrl);
const publisher = redisConnection(config.redisUrl);
const subscriber = redisConnection(config.redisUrl);
const queues = createQueues(connection, prefix);
const storage = createStorageFromEnv();

logger.info({ engines: availableEngines(), concurrency: config.concurrency }, "worker starting");

// Cancellation signals from the API.
await subscriber.subscribe(REDIS_CHANNELS.cancel);
subscriber.on("message", (_channel, raw) => {
  try {
    const { runIds } = JSON.parse(raw) as { runIds: string[] };
    for (const id of runIds) activeRuns.get(id)?.abort();
  } catch {
    /* ignore malformed */
  }
});

const runWorker = new Worker<RunJobData>(
  QUEUE_NAMES.runs,
  async (job) => {
    const result = await executeRun(job.data.runId, {
      storage,
      redis: publisher,
      policy: config.policy,
      encryptionKey: config.encryptionKey,
      workerId: config.workerId,
      logger,
      heartbeatMs: config.heartbeatMs,
      maxInfraAttempts: config.maxInfraAttempts,
      headless: config.headless,
      allowThirdPartySubresources: config.allowThirdPartySubresources,
    });
    const run = await prisma.testRun.findUnique({ where: { id: job.data.runId }, select: { batchId: true } });
    if (run) await dispatchBatch(run.batchId, { queues, redis: publisher, limits: config.limits });
    return result;
  },
  { connection: redisConnection(config.redisUrl), prefix, concurrency: config.concurrency, lockDuration: 60_000 },
);

const proxyWorker = new Worker<ProxyTestJobData, ProxyTestResult>(
  QUEUE_NAMES.proxyTests,
  (job) => runProxyTest(job.data.proxyProfileId, { encryptionKey: config.encryptionKey, checkUrl: config.proxyCheckUrl, policy: config.policy }),
  { connection: redisConnection(config.redisUrl), prefix, concurrency: 2 },
);

runWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message }, "run job failed"));
proxyWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message }, "proxy test job failed"));

// Advertise installed engines so the API can validate browser selections.
const advertise = () =>
  publisher.hset("js:worker-engines", config.workerId, JSON.stringify({ engines: availableEngines(), at: Date.now() })).catch(() => undefined);
await advertise();

// Maintenance: stale recovery + dispatch of batches waiting on capacity.
let maintaining = false;
const maintenance = setInterval(async () => {
  if (maintaining) return;
  maintaining = true;
  try {
    await advertise();
    await recoverStaleRuns({
      staleAfterMs: config.staleAfterMs,
      maxAttempts: config.maxInfraAttempts,
      reenqueue: (runId) => enqueueRun(queues, runId),
      logger,
    });
    const batches = await prisma.testBatch.findMany({
      where: { status: { in: ["QUEUED", "RUNNING", "CANCELLING"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const b of batches) await dispatchBatch(b.id, { queues, redis: publisher, limits: config.limits });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "maintenance failed");
  } finally {
    maintaining = false;
  }
}, config.maintenanceIntervalMs);

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down; requeueing in-flight runs");
  clearInterval(maintenance);
  await publisher.hdel("js:worker-engines", config.workerId).catch(() => undefined);
  for (const c of activeRuns.values()) c.abort(WORKER_SHUTDOWN);
  await Promise.allSettled([runWorker.close(), proxyWorker.close()]);
  await Promise.allSettled([queues.close(), connection.quit(), publisher.quit(), subscriber.quit(), prisma.$disconnect()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
