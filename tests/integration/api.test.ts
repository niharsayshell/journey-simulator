/**
 * API integration tests against real PostgreSQL and Redis (no browser workers).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDemoSite } from "../../apps/demo-site/src/server";
import { Client, createTestApp, flushRedis, prisma, registerUser, resetDatabase, setupProject, type TestApp } from "../setup/helpers";

let t: TestApp;
let site: ReturnType<typeof createDemoSite>;
let port: number;

const scenarioBody = (projectId: string, origin: string) => ({
  projectId,
  name: "Checkout",
  definition: {
    startUrl: `${origin}/`,
    steps: [
      { id: "a", type: "NAVIGATE", url: "/products" },
      { id: "b", type: "ASSERT_URL", expected: "/products", match: "pathEquals" },
    ],
  },
});

beforeAll(async () => {
  t = await createTestApp();
  site = createDemoSite({ port: 0 });
  port = await site.listen();
});
afterAll(async () => {
  await t?.close();
  await site?.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  await flushRedis(t.redis);
});

describe("authentication", () => {
  it("registers, reads the session, logs out", async () => {
    const c = new Client(t);
    await registerUser(c, "alice@example.com");
    expect((await c.get("/auth/me")).body.user.email).toBe("alice@example.com");
    await c.post("/auth/logout");
    expect((await c.get("/auth/me")).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const c = new Client(t);
    await registerUser(c);
    const token = c.cookie.split("=")[1]!;
    const sessions = await prisma.authSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toContain(token);
  });

  it("rejects bad credentials with a structured error", async () => {
    const c = new Client(t);
    await registerUser(c, "bob@example.com");
    const r = await new Client(t).post("/auth/login", { email: "bob@example.com", password: "wrong-password" });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password" } });
  });

  it("closes sign-up after the first account in first-user mode", async () => {
    const locked = await createTestApp({ ALLOW_REGISTRATION: "first-user" });
    try {
      await registerUser(new Client(locked));
      const r = await new Client(locked).post("/auth/register", { email: "late@example.com", password: "correct-horse-battery" });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("REGISTRATION_DISABLED");
    } finally {
      await locked.close();
    }
  });

  it("requires authentication for project data", async () => {
    expect((await new Client(t).get("/projects")).status).toBe(401);
  });

  it("validates input", async () => {
    const r = await new Client(t).post("/auth/register", { email: "not-an-email", password: "short" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "password"]);
  });

  it("rejects cross-origin state-changing requests and non-JSON bodies", async () => {
    const c = new Client(t);
    await registerUser(c);
    expect((await c.req("POST", "/projects", { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    const form = await t.app.inject({ method: "POST", url: "/api/v1/projects", payload: "name=x", headers: { "content-type": "application/x-www-form-urlencoded", cookie: c.cookie } });
    expect(form.statusCode).toBe(415);
  });
});

describe("project scoping and roles", () => {
  it("hides other users' projects (404, not 403)", async () => {
    const alice = new Client(t);
    await registerUser(alice);
    const p = await alice.post("/projects", { name: "Alice project" });
    const mallory = new Client(t);
    await registerUser(mallory);
    expect((await mallory.get(`/projects/${p.body.project.id}`)).status).toBe(404);
    expect((await mallory.get(`/scenarios?projectId=${p.body.project.id}`)).status).toBe(404);
    expect((await mallory.get("/projects")).body.items).toHaveLength(0);
  });

  it("prevents viewers from mutating", async () => {
    const owner = new Client(t);
    await registerUser(owner);
    const { projectId, origin } = await setupProject(owner, site, port);
    const viewer = new Client(t);
    const v = await registerUser(viewer);
    await prisma.projectMembership.create({ data: { projectId, userId: v.id, role: "VIEWER" } });
    expect((await viewer.get(`/scenarios?projectId=${projectId}`)).status).toBe(200);
    const r = await viewer.post("/scenarios", scenarioBody(projectId, origin));
    expect(r.status).toBe(403);
  });

  it("paginates with cursors", async () => {
    const c = new Client(t);
    await registerUser(c);
    for (let i = 0; i < 5; i++) await c.post("/projects", { name: `P${i}` });
    const page1 = await c.get("/projects?limit=2");
    expect(page1.body.items).toHaveLength(2);
    const page2 = await c.get(`/projects?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(2);
    const page3 = await c.get(`/projects?limit=2&cursor=${page2.body.nextCursor}`);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();
    const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("website authorization", () => {
  it("verifies a domain through the hosted file", async () => {
    const c = new Client(t);
    await registerUser(c);
    const { projectId } = await setupProject(c, site, port);
    const domains = await c.get(`/domains?projectId=${projectId}`);
    expect(domains.body.items[0].status).toBe("VERIFIED");
    expect((await prisma.auditLog.findMany({ where: { action: "domain.verified" } })).length).toBe(1);
  });

  it("keeps a domain unverified when the file is missing", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    const d = await c.post("/domains", { projectId: p.body.project.id, host: `localhost:${port}`, scheme: "http" });
    const v = await c.post(`/domains/${d.body.domain.id}/verify`);
    expect(v.body.result.ok).toBe(false);
    expect(v.body.domain.status).toBe("FAILED");
  });

  it("rejects unsafe or ambiguous hosts", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    const projectId = p.body.project.id;
    for (const host of ["metadata.google.internal", "10.0.0.5", "intranet", "-bad.com", "a.com:80"]) {
      const r = await c.post("/domains", { projectId, host });
      expect(r.status, host).toBe(400);
    }
  });

  it("refuses to save scenarios targeting unverified domains", async () => {
    const c = new Client(t);
    await registerUser(c);
    const { projectId, origin } = await setupProject(c, site, port);
    const body = scenarioBody(projectId, origin);
    body.definition.steps.push({ id: "z", type: "NAVIGATE", url: "https://not-mine.example.com/" } as never);
    const r = await c.post("/scenarios", body);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("UNAUTHORIZED_TARGET");
    expect(r.body.error.details[0].path).toBe("steps.2.url");
  });
});

describe("quick start and self-declared websites", () => {
  it("requires the ownership/permission confirmation", async () => {
    const c = new Client(t);
    await registerUser(c);
    const r = await c.post("/quick-start", { url: `http://localhost:${port}/` });
    expect(r.status).toBe(400);
    expect(await prisma.project.count()).toBe(0);
  });

  it("creates a project, a self-declared website and a runnable starter scenario in one step", async () => {
    const c = new Client(t);
    const user = await registerUser(c);
    const r = await c.post("/quick-start", { url: `localhost:${port}/products`, attestation: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const projectId = r.body.project.id;
    const domain = await prisma.verifiedDomain.findFirstOrThrow({ where: { projectId } });
    expect(domain).toMatchObject({ hostname: "localhost", port, status: "ATTESTED", method: "SELF_ATTESTED", attestedById: user.id, scheme: "http" });
    expect(await prisma.auditLog.count({ where: { projectId, action: "domain.attested" } })).toBe(1);
    const sc = await c.get(`/scenarios/${r.body.scenarioId}`);
    // No scheme typed and the site only speaks http → http was detected.
    expect(sc.body.scenario.definition.startUrl).toBe(`http://localhost:${port}/products`);
    expect(sc.body.scenario.definition.steps.map((s: { type: string }) => s.type)).toEqual(["NAVIGATE", "WAIT", "SCROLL", "SCREENSHOT"]);
    const dry = await c.post("/batches", { scenarioId: r.body.scenarioId, iterations: 2, dryRun: true });
    expect(dry.body).toMatchObject({ valid: true });
  });

  it("still blocks private and metadata addresses and cleans up on failure", async () => {
    const c = new Client(t);
    await registerUser(c);
    for (const url of ["http://10.0.0.5/", "http://169.254.169.254/latest", "http://intranet/"]) {
      const r = await c.post("/quick-start", { url, attestation: true });
      expect(r.status, url).toBe(400);
    }
    expect(await prisma.project.count()).toBe(0);
  });

  it("can be switched off by the administrator", async () => {
    const strict = await createTestApp({ ALLOW_SELF_ATTESTED_DOMAINS: "false" });
    try {
      const c = new Client(strict);
      await registerUser(c);
      const r = await c.post("/quick-start", { url: `http://localhost:${port}/`, attestation: true });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("ATTESTATION_DISABLED");
    } finally {
      await strict.close();
    }
  });

  it("lets a self-declared website be upgraded to verified, and never downgrades it on a failed check", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    const d = await c.post("/domains", { projectId: p.body.project.id, host: `localhost:${port}`, scheme: "http", method: "SELF_ATTESTED", attestation: true });
    expect(d.body.domain.status).toBe("ATTESTED");
    const failed = await c.post(`/domains/${d.body.domain.id}/verify`, { method: "HTTP_FILE" });
    expect(failed.body.domain.status).toBe("ATTESTED");
    site.addVerificationValue(d.body.domain.instructions.file.contents);
    const ok = await c.post(`/domains/${d.body.domain.id}/verify`, { method: "HTTP_FILE" });
    expect(ok.body.domain).toMatchObject({ status: "VERIFIED", method: "HTTP_FILE" });
  });
});

describe("scenarios", () => {
  it("creates, versions and archives scenarios", async () => {
    const c = new Client(t);
    await registerUser(c);
    const { projectId, origin } = await setupProject(c, site, port);
    const created = await c.post("/scenarios", scenarioBody(projectId, origin));
    expect(created.status).toBe(201);
    const id = created.body.scenario.id;

    // Renaming alone does not create a version.
    await c.put(`/scenarios/${id}`, { name: "Renamed" });
    expect((await c.get(`/scenarios/${id}`)).body.scenario).toMatchObject({ name: "Renamed", latestVersion: 1 });

    const def = scenarioBody(projectId, origin).definition;
    def.steps.push({ id: "c", type: "SCREENSHOT" } as never);
    const updated = await c.put(`/scenarios/${id}`, { definition: def, changeNote: "add screenshot" });
    expect(updated.body.scenario.latestVersion).toBe(2);

    const v1 = await c.get(`/scenarios/${id}?version=1`);
    expect(v1.body.scenario.definition.steps).toHaveLength(2);
    const latest = await c.get(`/scenarios/${id}`);
    expect(latest.body.scenario.definition.steps).toHaveLength(3);
    expect(latest.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(await prisma.scenarioStep.count()).toBe(5);

    await c.del(`/scenarios/${id}`);
    expect((await c.get(`/scenarios?projectId=${projectId}`)).body.items).toHaveLength(0);
  });

  it("rejects invalid definitions", async () => {
    const c = new Client(t);
    await registerUser(c);
    const { projectId, origin } = await setupProject(c, site, port);
    const r = await c.post("/scenarios", { ...scenarioBody(projectId, origin), definition: { startUrl: `${origin}/`, steps: [{ id: "x", type: "RUN_JS", code: "1" }] } });
    expect(r.status).toBe(400);
  });
});

describe("proxy profiles", () => {
  it("encrypts credentials and never returns them", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    const r = await c.post("/proxy-profiles", {
      projectId: p.body.project.id,
      name: "EU",
      type: "HTTP",
      host: "proxy.example.net",
      port: 3128,
      username: "qa-user",
      password: "s3cr3t-pass",
      regionLabel: "Frankfurt",
    });
    expect(r.status).toBe(201);
    const raw = JSON.stringify(r.body) + JSON.stringify((await c.get(`/proxy-profiles?projectId=${p.body.project.id}`)).body);
    expect(raw).not.toContain("s3cr3t-pass");
    expect(raw).not.toContain("qa-user");
    expect(raw).not.toContain("credentialSecretId");
    expect(r.body.profile.hasCredentials).toBe(true);
    const secret = await prisma.encryptedSecret.findFirstOrThrow();
    expect(secret.ciphertext).not.toContain("s3cr3t");
    const audit = JSON.stringify(await prisma.auditLog.findMany());
    expect(audit).not.toContain("s3cr3t-pass");
  });

  it("updates and clears credentials", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    const r = await c.post("/proxy-profiles", { projectId: p.body.project.id, name: "A", host: "proxy.example.net", port: 3128 });
    expect(r.body.profile.hasCredentials).toBe(false);
    const u = await c.patch(`/proxy-profiles/${r.body.profile.id}`, { username: "u", password: "p" });
    expect(u.body.profile.hasCredentials).toBe(true);
    const cleared = await c.patch(`/proxy-profiles/${r.body.profile.id}`, { clearCredentials: true });
    expect(cleared.body.profile.hasCredentials).toBe(false);
    expect(await prisma.encryptedSecret.count()).toBe(0);
  });

  it("rejects metadata proxy hosts", async () => {
    const c = new Client(t);
    await registerUser(c);
    const p = await c.post("/projects", { name: "x" });
    expect((await c.post("/proxy-profiles", { projectId: p.body.project.id, name: "A", host: "169.254.169.254", port: 80 })).status).toBe(400);
  });
});

describe("batches", () => {
  async function scenario() {
    const c = new Client(t);
    await registerUser(c);
    const { projectId, origin } = await setupProject(c, site, port);
    const s = await c.post("/scenarios", scenarioBody(projectId, origin));
    return { c, projectId, scenarioId: s.body.scenario.id as string };
  }

  it("dry run validates without creating records", async () => {
    const { c, scenarioId } = await scenario();
    const r = await c.post("/batches", { scenarioId, iterations: 5, concurrency: 2, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, valid: true, issues: [] });
    expect(await prisma.testBatch.count()).toBe(0);
  });

  it("enforces administrator limits", async () => {
    const { c, scenarioId } = await scenario();
    const r = await c.post("/batches", { scenarioId, iterations: 1000, concurrency: 50 });
    expect(r.status).toBe(422);
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["concurrency", "iterations"]);
  });

  it("rejects unimplemented session modes", async () => {
    const { c, scenarioId } = await scenario();
    const r = await c.post("/batches", { scenarioId, sessionMode: "RETURNING_SESSION", dryRun: true });
    expect(r.body.valid).toBe(false);
    expect(r.body.issues[0].path).toBe("sessionMode");
  });

  it("rejects batches after the domain authorization is removed", async () => {
    const { c, scenarioId, projectId } = await scenario();
    const d = await c.get(`/domains?projectId=${projectId}`);
    await c.del(`/domains/${d.body.items[0].id}`);
    const r = await c.post("/batches", { scenarioId });
    expect(r.status).toBe(422);
    expect(r.body.error.details[0].message).toMatch(/not an authorized domain/);
  });

  it("creates one run record per iteration and dispatches up to the concurrency", async () => {
    const { c, scenarioId } = await scenario();
    const r = await c.post("/batches", { scenarioId, iterations: 4, concurrency: 2 });
    expect(r.status).toBe(201);
    const runs = await prisma.testRun.findMany({ where: { batchId: r.body.batch.id }, orderBy: { iteration: "asc" } });
    expect(runs.map((x) => x.iteration)).toEqual([1, 2, 3, 4]);
    expect(new Set(runs.map((x) => x.id)).size).toBe(4);
    expect(runs.map((x) => x.status)).toEqual(["DISPATCHED", "DISPATCHED", "QUEUED", "QUEUED"]);
    const jobs = await t.queues.runs.getJobs(["waiting", "delayed"]);
    expect(jobs.map((j) => j.id).sort()).toEqual([runs[0]!.id, runs[1]!.id].sort());
  });

  it("cancels queued runs immediately and exports reports", async () => {
    const { c, scenarioId } = await scenario();
    const b = await c.post("/batches", { scenarioId, iterations: 3, concurrency: 1 });
    const cancel = await c.post(`/batches/${b.body.batch.id}/cancel`);
    expect(cancel.status).toBe(200);
    const detail = await c.get(`/batches/${b.body.batch.id}`);
    expect(detail.body.batch.status).toBe("CANCELLED");
    expect(detail.body.counts).toMatchObject({ cancelled: 3, total: 3 });
    expect((await c.post(`/batches/${b.body.batch.id}/cancel`)).status).toBe(409);

    const csv = await c.get(`/reports?batchId=${b.body.batch.id}&format=csv`);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (csv.raw as string).trim().split("\r\n");
    expect(lines[0]).toMatch(/^batch_id,run_id,scenario_version,iteration,run_status/);
    expect(lines).toHaveLength(4);
    const json = await c.get(`/reports?batchId=${b.body.batch.id}&format=json`);
    expect(json.body.stats).toMatchObject({ total: 3, cancelled: 3, passRate: null });
  });
});

describe("system", () => {
  it("reports health", async () => {
    const r = await new Client(t).get("/health");
    expect(r.body).toEqual({ status: "ok", checks: { database: "ok", redis: "ok" } });
  });
});
