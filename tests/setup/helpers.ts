import { prisma } from "@js/database";
import { createQueues, redisConnection, type Queues, type Redis } from "@js/queue";
import { createSecretBox } from "@js/security";
import { LocalFsStorage } from "@js/storage";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { buildApp } from "../../apps/api/src/app";
import { loadApiConfig } from "../../apps/api/src/config";

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function flushRedis(redis: Redis) {
  await redis.flushdb();
}

export interface TestApp {
  app: Awaited<ReturnType<typeof buildApp>>;
  redis: Redis;
  queues: Queues;
  storage: LocalFsStorage;
  storageDir: string;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadApiConfig({ ...process.env, APP_ORIGIN: "http://localhost:3000", RATE_LIMIT_PER_MINUTE: "10000", PRIVATE_HOST_ALLOWLIST: "localhost,127.0.0.1", ...env });
  const redis = redisConnection(config.redisUrl);
  const queues = createQueues(redisConnection(config.redisUrl), "jstest");
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "js-artifacts-"));
  const storage = new LocalFsStorage(storageDir);
  const subscribers: Redis[] = [];
  const app = await buildApp(
    {
      config,
      redis,
      createSubscriber: () => {
        const s = redisConnection(config.redisUrl);
        subscribers.push(s);
        return s;
      },
      queues,
      storage,
      secrets: createSecretBox(config.encryptionKey),
    },
    { logger: false },
  );
  await app.ready();
  return {
    app,
    redis,
    queues,
    storage,
    storageDir,
    async close() {
      await app.close();
      await queues.close();
      await Promise.allSettled(subscribers.map((s) => s.quit()));
      await redis.quit();
    },
  };
}

/** Minimal cookie-jar client around fastify.inject. */
export class Client {
  cookie = "";
  constructor(private readonly t: TestApp) {}
  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.t.app.inject({
      method: method as "GET",
      url: `/api/v1${url}`,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) {
      const first = (Array.isArray(set) ? set[0] : set)!.split(";")[0]!;
      this.cookie = first.endsWith("=") ? "" : first;
    }
    let json: T;
    try {
      json = res.json() as T;
    } catch {
      json = res.body as unknown as T;
    }
    return { status: res.statusCode, body: json, headers: res.headers, raw: res.body };
  }
  get = <T = any>(url: string) => this.req<T>("GET", url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>("POST", url, body);
  put = <T = any>(url: string, body: unknown) => this.req<T>("PUT", url, body);
  patch = <T = any>(url: string, body: unknown) => this.req<T>("PATCH", url, body);
  del = <T = any>(url: string) => this.req<T>("DELETE", url);
}

let userSeq = 0;
export async function registerUser(c: Client, email = `user${++userSeq}-${Date.now()}@example.com`) {
  const r = await c.post("/auth/register", { email, password: "correct-horse-battery", name: "Tester" });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return r.body.user as { id: string; email: string };
}

/** Create a project with a VERIFIED domain for the demo site at `origin`. */
export async function setupProject(c: Client, demo: { addVerificationValue(v: string): void }, port: number) {
  const p = await c.post("/projects", { name: "Test project" });
  const projectId = p.body.project.id as string;
  const d = await c.post("/domains", { projectId, host: `localhost:${port}`, scheme: "http" });
  if (d.status !== 201) throw new Error(`domain failed: ${JSON.stringify(d.body)}`);
  demo.addVerificationValue(d.body.domain.instructions.file.contents);
  const v = await c.post(`/domains/${d.body.domain.id}/verify`);
  if (v.body.domain?.status !== "VERIFIED") throw new Error(`verify failed: ${JSON.stringify(v.body)}`);
  return { projectId, domainId: d.body.domain.id as string, origin: `http://localhost:${port}` };
}

export { prisma };
