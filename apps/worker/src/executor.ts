import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Logger } from "pino";
import type { Page } from "playwright";
import { prisma, type PrismaClient } from "@js/database";
import {
  BrowserUnavailableError,
  DEFAULT_BROWSER_PROFILE,
  launchBrowserSession,
  type BrowserProfileConfig,
  type BrowserSession,
  type ProxyConfig,
} from "@js/browser-engine";
import { runScenario, type RunOutcome, type StepOutcome } from "@js/scenario-engine";
import {
  assertNavigationAllowed,
  createSecretBox,
  UrlPolicyError,
  type AuthorizedHost,
  type NetworkPolicy,
} from "@js/security";
import {
  collectNavigationUrls,
  IMPLEMENTED_SESSION_MODES,
  usableDomainStatuses,
  scenarioDefinitionSchema,
  type ErrorCategory,
  type RunStatus,
  type SessionMode,
} from "@js/shared";
import { publishEvent, type Redis } from "@js/queue";
import type { StorageAdapter } from "@js/storage";

/** Snapshot written to TestBatch.configSnapshot by the API. */
export interface BatchConfigSnapshot {
  browserProfile: (BrowserProfileConfig & { id: string | null; name: string }) | null;
  proxy: { id: string; name: string; type: ProxyConfig["type"]; host: string; port: number; regionLabel: string | null; hasCredentials: boolean } | null;
  sessionMode: SessionMode;
  testHeader: { name: string; value: string } | null;
}

export interface ExecutorDeps {
  db?: PrismaClient;
  storage: StorageAdapter;
  redis: Redis;
  policy: NetworkPolicy;
  encryptionKey: string;
  workerId: string;
  logger: Logger;
  heartbeatMs?: number;
  maxInfraAttempts?: number;
  headless?: boolean;
  allowThirdPartySubresources?: boolean;
}

export type ExecuteResult = { outcome: "skipped" | "finished" | "requeued"; status?: RunStatus };

/** Registry of in-flight runs so cancellation messages can abort them. */
export const activeRuns = new Map<string, AbortController>();
/** Abort reason used when the worker process is stopping. */
export const WORKER_SHUTDOWN = "WORKER_SHUTDOWN";

class RunSetupError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

/**
 * Execute one run end to end. Idempotent: a run is only executed by the worker
 * that atomically claims it (DISPATCHED → RUNNING).
 */
export async function executeRun(runId: string, deps: ExecutorDeps): Promise<ExecuteResult> {
  const db = deps.db ?? prisma;
  const log = deps.logger.child({ runId });

  const claimed = await db.testRun.updateMany({
    where: { id: runId, status: "DISPATCHED" },
    data: { status: "RUNNING", workerId: deps.workerId, startedAt: new Date(), heartbeatAt: new Date(), attempt: { increment: 1 }, cancelRequested: false },
  });
  if (claimed.count === 0) {
    log.info("run not claimable (already handled or cancelled); skipping");
    return { outcome: "skipped" };
  }

  const run = await db.testRun.findUniqueOrThrow({
    where: { id: runId },
    include: { batch: { include: { scenarioVersion: true, project: true } } },
  });
  const batch = run.batch;
  // Remove partial results of a previous (stale/retried) attempt.
  await db.artifact.deleteMany({ where: { runId } });
  await db.stepResult.deleteMany({ where: { runId } });
  await db.testBatch.updateMany({ where: { id: batch.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  await publishEvent(deps.redis, { type: "run.updated", projectId: batch.projectId, batchId: batch.id, runId, status: "RUNNING" });

  const controller = new AbortController();
  activeRuns.set(runId, controller);
  const heartbeat = setInterval(async () => {
    try {
      const r = await db.testRun.findUnique({ where: { id: runId }, select: { cancelRequested: true, status: true } });
      if (!r || r.cancelRequested || r.status !== "RUNNING") controller.abort();
      else await db.testRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { heartbeatAt: new Date() } });
    } catch (err) {
      log.warn({ err }, "heartbeat failed");
    }
  }, deps.heartbeatMs ?? 5000);

  let session: BrowserSession | undefined;
  let traceDir: string | undefined;
  let outcome: RunOutcome | undefined;
  let setupError: RunSetupError | undefined;
  const started = Date.now();
  const snapshot = batch.configSnapshot as unknown as BatchConfigSnapshot;
  const retentionDays = batch.project.artifactRetentionDays;
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);

  const saveArtifact = async (kind: "SCREENSHOT" | "TRACE", key: string, body: Buffer, contentType: string, stepIndex?: number) => {
    await deps.storage.put(key, body, contentType);
    const a = await db.artifact.create({
      data: { runId, kind, storageKey: key, contentType, sizeBytes: body.length, expiresAt },
    });
    return { id: a.id, stepIndex };
  };
  const pendingStepArtifacts = new Map<number, string[]>();

  try {
    // ---- Validate (worker-level enforcement; never trust earlier checks) ----
    const parsed = scenarioDefinitionSchema.safeParse(batch.scenarioVersion.definition);
    if (!parsed.success) throw new RunSetupError("VALIDATION", `Scenario version is invalid: ${parsed.error.issues[0]?.message}`);
    const definition = parsed.data;
    if (!IMPLEMENTED_SESSION_MODES.includes(snapshot.sessionMode)) {
      throw new RunSetupError("VALIDATION", `Session mode ${snapshot.sessionMode} is not implemented yet`);
    }

    const domains = await db.verifiedDomain.findMany({ where: { projectId: batch.projectId, status: { in: usableDomainStatuses(process.env) } } });
    const authorizedHosts: AuthorizedHost[] = domains.map((d) => ({ hostname: d.hostname, port: d.port, allowSubdomains: d.allowSubdomains }));
    for (const u of collectNavigationUrls(definition)) {
      try {
        await assertNavigationAllowed(u.toString(), authorizedHosts, deps.policy);
      } catch (err) {
        if (err instanceof UrlPolicyError) throw new RunSetupError(err.code === "DNS_FAILURE" ? "NETWORK" : "SECURITY", err.message);
        throw err;
      }
    }

    // ---- Network profile ----
    let proxy: ProxyConfig | null = null;
    if (snapshot.proxy) {
      const p = await db.proxyProfile.findFirst({
        where: { id: snapshot.proxy.id, projectId: batch.projectId },
        include: { credentialSecret: true },
      });
      if (!p) throw new RunSetupError("VALIDATION", "The selected proxy profile no longer exists");
      proxy = { type: snapshot.proxy.type, host: snapshot.proxy.host, port: snapshot.proxy.port };
      if (p.credentialSecret) {
        const creds = JSON.parse(createSecretBox(deps.encryptionKey).decrypt(p.credentialSecret.ciphertext)) as { username?: string; password?: string };
        proxy.username = creds.username;
        proxy.password = creds.password;
      }
    }

    if (controller.signal.aborted) throw new RunSetupError("CANCELLED", "Run was cancelled before launch");

    // ---- Launch ----
    const profile = snapshot.browserProfile ?? { ...DEFAULT_BROWSER_PROFILE, id: null, name: "Default desktop" };
    try {
      session = await launchBrowserSession({
        profile,
        proxy,
        headless: deps.headless ?? true,
        guard: {
          authorizedHosts,
          policy: deps.policy,
          testHeader: snapshot.testHeader,
          allowThirdPartySubresources: deps.allowThirdPartySubresources ?? true,
        },
      });
    } catch (err) {
      if (err instanceof BrowserUnavailableError) throw new RunSetupError("INFRASTRUCTURE", err.message, false);
      throw new RunSetupError("INFRASTRUCTURE", `Browser launch failed: ${(err as Error).message.split("\n")[0]}`, true);
    }
    // Cancellation closes the browser so in-flight Playwright calls stop immediately.
    controller.signal.addEventListener("abort", () => void session?.context.close().catch(() => undefined), { once: true });

    if (batch.captureTrace) {
      traceDir = await mkdtemp(path.join(os.tmpdir(), "js-trace-"));
      await session.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }

    log.info({ engine: profile.engine, proxy: proxy ? `${proxy.host}:${proxy.port}` : null }, "run started");

    outcome = await runScenario({
      page: session.page,
      definition,
      signal: controller.signal,
      hooks: {
        securityViolation: () => session!.guard.navigationViolation(),
        captureScreenshot: async (page: Page, info) => {
          const buf = await page.screenshot({ fullPage: info.fullPage, timeout: 10_000 });
          const key = `runs/${runId}/step-${String(info.stepIndex).padStart(3, "0")}-${info.reason}-${Date.now()}.png`;
          const a = await saveArtifact("SCREENSHOT", key, buf, "image/png", info.stepIndex);
          const list = pendingStepArtifacts.get(info.stepIndex) ?? [];
          list.push(a.id);
          pendingStepArtifacts.set(info.stepIndex, list);
          return a.id;
        },
        onStepComplete: async (step) => {
          await persistStep(db, runId, step);
          await publishEvent(deps.redis, {
            type: "step.completed",
            projectId: batch.projectId,
            batchId: batch.id,
            runId,
            stepIndex: step.index,
            status: step.status,
          });
        },
      },
    });

    // Persist skipped steps (not reported through the hook).
    for (const s of outcome.steps) if (s.status === "SKIPPED") await persistStep(db, runId, s);
  } catch (err) {
    setupError = err instanceof RunSetupError ? err : new RunSetupError("INFRASTRUCTURE", (err as Error).message ?? String(err), true);
    log.warn({ err: setupError.message, category: setupError.category }, "run setup failed");
  } finally {
    clearInterval(heartbeat);
    activeRuns.delete(runId);
    if (session && traceDir && batch.captureTrace) {
      try {
        const file = path.join(traceDir, "trace.zip");
        await session.context.tracing.stop({ path: file });
        await saveArtifact("TRACE", `runs/${runId}/trace.zip`, await readFile(file), "application/zip");
      } catch (err) {
        log.warn({ err: (err as Error).message }, "trace capture failed");
      }
    }
    if (traceDir) await rm(traceDir, { recursive: true, force: true }).catch(() => undefined);
    await session?.close();
  }

  // Link screenshots to their step results.
  for (const [stepIndex, ids] of pendingStepArtifacts) {
    const sr = await db.stepResult.findUnique({ where: { runId_stepIndex: { runId, stepIndex } }, select: { id: true } });
    if (sr) await db.artifact.updateMany({ where: { id: { in: ids } }, data: { stepResultId: sr.id } });
  }

  // Worker shutdown is not a user cancellation: hand the run back to the queue.
  if (controller.signal.aborted && controller.signal.reason === WORKER_SHUTDOWN) {
    await db.stepResult.deleteMany({ where: { runId } });
    const r = await db.testRun.updateMany({
      where: { id: runId, status: "RUNNING", workerId: deps.workerId },
      data: { status: "QUEUED", workerId: null, heartbeatAt: null, errorMessage: "Interrupted by worker shutdown; requeued" },
    });
    if (r.count) return { outcome: "requeued" };
  }

  // ---- Final status ----
  const cancelled = controller.signal.aborted && (!outcome || outcome.status === "CANCELLED");
  let status: RunStatus;
  let errorCategory: ErrorCategory | undefined;
  let errorMessage: string | undefined;
  if (setupError) {
    const maxAttempts = deps.maxInfraAttempts ?? 2;
    if (setupError.retryable && run.attempt < maxAttempts && !controller.signal.aborted) {
      const r = await db.testRun.updateMany({
        where: { id: runId, status: "RUNNING", workerId: deps.workerId },
        data: { status: "QUEUED", errorMessage: `Attempt ${run.attempt} failed: ${setupError.message}`, heartbeatAt: null },
      });
      if (r.count) {
        log.info("infrastructure failure; run requeued for another attempt");
        return { outcome: "requeued" };
      }
    }
    status = setupError.category === "CANCELLED" || cancelled ? "CANCELLED" : "FAILED";
    errorCategory = status === "CANCELLED" ? "CANCELLED" : setupError.category;
    errorMessage = setupError.message;
  } else if (outcome) {
    status = cancelled ? "CANCELLED" : outcome.status;
    errorCategory = cancelled ? "CANCELLED" : outcome.errorCategory;
    errorMessage = cancelled ? "Run was cancelled" : outcome.errorMessage;
    // Defensive: a run can only pass when every step passed.
    if (status === "PASSED" && outcome.steps.some((s) => s.status !== "PASSED")) {
      status = "FAILED";
      errorMessage ??= "Not all steps passed";
    }
  } else {
    status = "FAILED";
    errorCategory = "INFRASTRUCTURE";
    errorMessage = "Run ended without an outcome";
  }

  const finished = await db.testRun.updateMany({
    where: { id: runId, status: "RUNNING", workerId: deps.workerId },
    data: {
      status,
      errorCategory: errorCategory ?? null,
      errorMessage: errorMessage?.slice(0, 2000) ?? null,
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      finalUrl: outcome?.finalUrl ?? null,
      navigationUrls: outcome?.navigationUrls ?? [],
      observed: session
        ? {
            ...session.observed,
            proxy: snapshot.proxy ? { server: `${snapshot.proxy.host}:${snapshot.proxy.port}`, regionLabel: snapshot.proxy.regionLabel } : null,
            blockedRequests: session.guard.blocked.slice(0, 50),
          }
        : undefined,
    },
  });
  if (finished.count === 0) log.warn("run state changed during execution (stale recovery?); result not written");
  log.info({ status, errorCategory, durationMs: Date.now() - started }, "run finished");
  await publishEvent(deps.redis, { type: "run.updated", projectId: batch.projectId, batchId: batch.id, runId, status });
  return { outcome: "finished", status };
}

async function persistStep(db: PrismaClient, runId: string, s: StepOutcome) {
  const data = {
    stepKey: s.stepKey,
    type: s.type,
    label: s.label ?? null,
    status: s.status,
    attempts: s.attempts,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    durationMs: s.durationMs,
    url: s.url?.slice(0, 2048) ?? null,
    errorCategory: s.errorCategory ?? null,
    errorMessage: s.errorMessage?.slice(0, 2000) ?? null,
    detail: (s.detail ?? undefined) as object | undefined,
  };
  await db.stepResult.upsert({
    where: { runId_stepIndex: { runId, stepIndex: s.index } },
    create: { runId, stepIndex: s.index, ...data },
    update: data,
  });
}

/**
 * Recover runs whose worker died: RUNNING runs with a stale heartbeat are
 * requeued (bounded) or failed; DISPATCHED runs whose job vanished are re-enqueued.
 */
export async function recoverStaleRuns(opts: {
  db?: PrismaClient;
  staleAfterMs: number;
  maxAttempts: number;
  reenqueue: (runId: string) => Promise<void>;
  logger: Logger;
}): Promise<{ requeued: number; failed: number; reenqueued: number; batchIds: string[] }> {
  const db = opts.db ?? prisma;
  const cutoff = new Date(Date.now() - opts.staleAfterMs);
  const stale = await db.testRun.findMany({
    where: { status: "RUNNING", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] },
    select: { id: true, attempt: true, batchId: true },
    take: 100,
  });
  let requeued = 0;
  let failed = 0;
  for (const r of stale) {
    if (r.attempt < opts.maxAttempts) {
      const u = await db.testRun.updateMany({
        where: { id: r.id, status: "RUNNING" },
        data: { status: "QUEUED", workerId: null, heartbeatAt: null, errorMessage: "Worker heartbeat lost; retrying" },
      });
      requeued += u.count;
    } else {
      const u = await db.testRun.updateMany({
        where: { id: r.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorCategory: "INFRASTRUCTURE",
          errorMessage: "Worker heartbeat lost; maximum attempts reached",
          finishedAt: new Date(),
        },
      });
      failed += u.count;
    }
  }
  if (stale.length) opts.logger.warn({ requeued, failed }, "recovered stale runs");

  // DISPATCHED for a long time → the BullMQ job may never have been created.
  const lost = await db.testRun.findMany({
    where: { status: "DISPATCHED", dispatchedAt: { lt: cutoff } },
    select: { id: true, batchId: true, batch: { select: { nextLaunchAt: true } } },
    take: 100,
  });
  let reenqueued = 0;
  for (const r of lost) {
    if (r.batch.nextLaunchAt && r.batch.nextLaunchAt.getTime() > Date.now()) continue; // still waiting for its launch slot
    await opts.reenqueue(r.id);
    reenqueued++;
  }
  return { requeued, failed, reenqueued, batchIds: [...new Set([...stale, ...lost].map((r) => r.batchId))] };
}
