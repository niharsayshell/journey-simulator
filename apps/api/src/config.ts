import { limitsFromEnv } from "@js/shared";
import { parsePrivateHostAllowlist } from "@js/security";

export function loadApiConfig(env: Record<string, string | undefined> = process.env) {
  const required = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  return {
    port: Number(env.API_PORT ?? 4000),
    host: env.API_HOST ?? "127.0.0.1",
    /** Public origin of the web app; state-changing requests must come from it. */
    appOrigin: env.APP_ORIGIN ?? "http://localhost:3000",
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    encryptionKey: required("ENCRYPTION_KEY"),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 7),
    cookieSecure: env.COOKIE_SECURE === "true",
    /** "true" (anyone), "false" (nobody), or "first-user" (only until the first account exists). */
    registration: (env.ALLOW_REGISTRATION === "false" ? "closed" : env.ALLOW_REGISTRATION === "first-user" ? "first-user" : "open") as
      | "open"
      | "closed"
      | "first-user",
    allowSelfAttested: env.ALLOW_SELF_ATTESTED_DOMAINS !== "false",
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
    policy: { privateHostAllowlist: parsePrivateHostAllowlist(env.PRIVATE_HOST_ALLOWLIST) },
    limits: limitsFromEnv(env),
    proxyTestTimeoutMs: Number(env.PROXY_TEST_TIMEOUT_MS ?? 45_000),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxy: env.TRUST_PROXY === "true",
  };
}
export type ApiConfig = ReturnType<typeof loadApiConfig>;
