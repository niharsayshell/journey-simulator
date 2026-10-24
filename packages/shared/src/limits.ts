/**
 * Conservative platform limits. Every value can be raised by an administrator
 * through environment variables (see .env.example); users cannot raise them.
 */
export interface PlatformLimits {
  maxIterationsPerBatch: number;
  maxConcurrencyPerBatch: number;
  maxActiveBatchesPerProject: number;
  maxActiveRunsPerDomain: number;
  maxActiveRunsSystem: number;
  minLaunchDelayMs: number;
}

export const DEFAULT_LIMITS: PlatformLimits = {
  maxIterationsPerBatch: 100,
  maxConcurrencyPerBatch: 3,
  maxActiveBatchesPerProject: 3,
  maxActiveRunsPerDomain: 5,
  maxActiveRunsSystem: 10,
  minLaunchDelayMs: 0,
};

export function limitsFromEnv(env: Record<string, string | undefined>): PlatformLimits {
  const n = (k: string, d: number) => {
    const v = env[k];
    if (v === undefined || v === "") return d;
    const parsed = Number.parseInt(v, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : d;
  };
  return {
    maxIterationsPerBatch: n("LIMIT_MAX_ITERATIONS_PER_BATCH", DEFAULT_LIMITS.maxIterationsPerBatch),
    maxConcurrencyPerBatch: n("LIMIT_MAX_CONCURRENCY_PER_BATCH", DEFAULT_LIMITS.maxConcurrencyPerBatch),
    maxActiveBatchesPerProject: n("LIMIT_MAX_ACTIVE_BATCHES_PER_PROJECT", DEFAULT_LIMITS.maxActiveBatchesPerProject),
    maxActiveRunsPerDomain: n("LIMIT_MAX_ACTIVE_RUNS_PER_DOMAIN", DEFAULT_LIMITS.maxActiveRunsPerDomain),
    maxActiveRunsSystem: n("LIMIT_MAX_ACTIVE_RUNS_SYSTEM", DEFAULT_LIMITS.maxActiveRunsSystem),
    minLaunchDelayMs: n("LIMIT_MIN_LAUNCH_DELAY_MS", DEFAULT_LIMITS.minLaunchDelayMs),
  };
}
