import os from "node:os";
import { limitsFromEnv } from "@js/shared";
import { parsePrivateHostAllowlist } from "@js/security";

export function loadWorkerConfig(env = process.env) {
  const required = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  return {
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    encryptionKey: required("ENCRYPTION_KEY"),
    workerId: env.WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    concurrency: Math.max(1, Number(env.WORKER_CONCURRENCY ?? 2)),
    heartbeatMs: Number(env.WORKER_HEARTBEAT_MS ?? 5000),
    staleAfterMs: Number(env.WORKER_STALE_AFTER_MS ?? 60_000),
    maintenanceIntervalMs: Number(env.WORKER_MAINTENANCE_INTERVAL_MS ?? 5000),
    maxInfraAttempts: Number(env.WORKER_MAX_INFRA_ATTEMPTS ?? 2),
    headless: env.WORKER_HEADLESS !== "false",
    allowThirdPartySubresources: env.ALLOW_THIRD_PARTY_SUBRESOURCES !== "false",
    proxyCheckUrl: env.PROXY_CHECK_URL ?? "https://api.ipify.org?format=json",
    policy: { privateHostAllowlist: parsePrivateHostAllowlist(env.PRIVATE_HOST_ALLOWLIST) },
    limits: limitsFromEnv(env),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
