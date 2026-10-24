/**
 * End-to-end: API + BullMQ + in-process worker + real browsers + bundled Demo
 * Shop + local test proxy. Nothing here touches external websites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import { Worker } from "bullmq";
import pino from "pino";
import { availableEngines } from "@js/browser-engine";
import { dispatchBatch, redisConnection } from "@js/queue";
import { DEFAULT_LIMITS, QUEUE_NAMES, type ProxyTestJobData, type ProxyTestResult, type RunJobData } from "@js/shared";
import { createDemoSite } from "../../apps/demo-site/src/server";
import { activeRuns, executeRun } from "../../apps/worker/src/executor";
import { runProxyTest } from "../../apps/worker/src/proxy-test";
import { createTestProxy } from "../fixtures/test-proxy";
import { Client, createTestApp, prisma, registerUser, resetDatabase, setupProject, type TestApp } from "../setup/helpers";

const policy = { privateHostAllowlist: ["localhost", "127.0.0.1"] };
const limits = { ...DEFAULT_LIMITS, maxActiveRunsSystem: 20 };
const engines = availableEngines();

let t: TestApp;
let site: ReturnType<typeof createDemoSite>;
let sitePort: number;
let proxy: ReturnType<typeof createTestProxy>;
let proxyPort: number;
let authProxy: ReturnType<typeof createTestProxy>;
let authProxyPort: number;
let runWorker: Worker<RunJobData>;
let proxyWorker: Worker<ProxyTestJobData, ProxyTestResult>;
const cancelSub = redisConnection(process.env.REDIS_URL);

let c: Client;
let projectId: string;
let origin: string;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestApp();
  await t.redis.flushdb();
  site = createDemoSite({ port: 0 });
  sitePort = await site.listen();
  proxy = createTestProxy();
  proxyPort = await proxy.listen();
  authProxy = createTestProxy({ auth: { username: "qa", password: "pa55word" } });
  authProxyPort = await authProxy.listen();

  const logger = pino({ level: "silent" });
  const deps = {
    storage: t.storage,
    redis: t.redis,
    policy,
    encryptionKey: process.env.ENCRYPTION_KEY!,
    workerId: `e2e-${os.hostname()}`,
    logger,
    heartbeatMs: 1000,
  };
  runWorker = new Worker<RunJobData>(
    QUEUE_NAMES.runs,
    async (job) => {
      const r = await executeRun(job.data.runId, deps);
      const run = await prisma.testRun.findUnique({ where: { id: job.data.runId }, select: { batchId: true } });
      if (run) await dispatchBatch(run.batchId, { queues: t.queues, redis: t.redis, limits });
      return r;
    },
    { connection: redisConnection(process.env.REDIS_URL), prefix: "jstest", concurrency: 3 },
  );
  proxyWorker = new Worker<ProxyTestJobData, ProxyTestResult>(
    QUEUE_NAMES.proxyTests,
    (job) => runProxyTest(job.data.proxyProfileId, { encryptionKey: process.env.ENCRYPTION_KEY!, checkUrl: `http://localhost:${sitePort}/whoami`, policy }),
    { connection: redisConnection(process.env.REDIS_URL), prefix: "jstest" },
  );
  await cancelSub.subscribe("journey:cancel");
  cancelSub.on("message", (_ch, raw) => {
    for (const id of (JSON.parse(raw) as { runIds: string[] }).runIds) activeRuns.get(id)?.abort();
  });

  c = new Client(t);
  await registerUser(c);
  ({ projectId, origin } = await setupProject(c, site, sitePort));
});

afterAll(async () => {
  await runWorker?.close();
  await proxyWorker?.close();
  await cancelSub.quit();
  await t?.close();
  await site?.close();
  await proxy?.close();
  await authProxy?.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  site.analytics.pageViews = 0;
  site.analytics.syntheticPageViews = 0;
});

async function createScenario(name: string, steps: unknown[], settings?: Record<string, number>) {
  const r = await c.post("/scenarios", { projectId, name, definition: { startUrl: `${origin}/`, settings, steps } });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.scenario.id as string;
}

async function startBatch(body: Record<string, unknown>) {
  const r = await c.post("/batches", body);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.batch.id as string;
}

async function waitForBatch(batchId: string, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await c.get(`/batches/${batchId}`);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(r.body.batch.status)) return r.body;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`Batch ${batchId} did not finish`);
}

async function runsOf(batchId: string) {
  return (await c.get(`/batches/${batchId}/runs`)).body.items as Array<{ id: string; status: string; errorCategory: string | null; errorMessage: string | null }>;
}

const cartSteps = [
  { id: "p", type: "NAVIGATE", url: "/products/echo-speaker" },
  { id: "q", type: "SELECT", target: { strategy: "label", value: "Quantity" }, option: "2" },
  { id: "a", type: "CLICK", target: { strategy: "role", value: "button", name: "Add to cart" } },
  { id: "n", type: "ASSERT_TEXT", target: { strategy: "testId", value: "cart-count" }, expected: "2", match: "equals", timeoutMs: 2000 },
  { id: "s", type: "SCREENSHOT" },
];

describe("repeated execution", () => {
  it("runs every iteration as a distinct record with screenshots, traces and the analytics header", async () => {
    const scenarioId = await createScenario("cart", cartSteps);
    const batchId = await startBatch({ scenarioId, iterations: 4, concurrency: 2, captureTrace: true });
    const result = await waitForBatch(batchId);
    expect(result.batch.status).toBe("COMPLETED");
    expect(result.counts).toMatchObject({ total: 4, passed: 4, failed: 0 });
    expect(result.stats.passRate).toBe(1);
    expect(result.stats.durationMs.p50).toBeGreaterThan(0);

    const runs = await runsOf(batchId);
    expect(new Set(runs.map((r) => r.id)).size).toBe(4);
    for (const run of runs) {
      const steps = (await c.get(`/runs/${run.id}/steps`)).body.items;
      expect(steps.map((s: { status: string }) => s.status)).toEqual(Array(5).fill("PASSED"));
      const detail = (await c.get(`/runs/${run.id}`)).body.run;
      expect(detail.observed.engine).toBe("chromium");
      expect(detail.navigationUrls[0]).toBe(`${origin}/products/echo-speaker`);
      const artifacts = (await c.get(`/runs/${run.id}/artifacts`)).body.items;
      const shot = artifacts.find((a: { kind: string }) => a.kind === "SCREENSHOT");
      const trace = artifacts.find((a: { kind: string }) => a.kind === "TRACE");
      expect(shot.stepResultId).toBe(steps[4].id);
      const png = await t.app.inject({ url: `/api/v1/artifacts/${shot.id}/content`, headers: { cookie: c.cookie } });
      expect(png.headers["content-type"]).toBe("image/png");
      expect(png.rawPayload.subarray(1, 4).toString()).toBe("PNG");
      const zip = await t.app.inject({ url: `/api/v1/artifacts/${trace.id}/content`, headers: { cookie: c.cookie } });
      expect(zip.rawPayload.subarray(0, 2).toString()).toBe("PK");
    }
    // Every page view carried the synthetic-traffic header.
    expect(site.analytics.syntheticPageViews).toBe(4);
    expect(site.analytics.pageViews).toBe(0);

    // Another user cannot read the artifacts.
    const other = new Client(t);
    await registerUser(other);
    const a = (await c.get(`/runs/${runs[0]!.id}/artifacts`)).body.items[0];
    expect((await other.get(`/artifacts/${a.id}/content`)).status).toBe(404);
  });

  it("uses a fresh, isolated browser state for every run", async () => {
    // If cookies/localStorage leaked between runs, later runs would see a cart count of 4, 6, ...
    const scenarioId = await createScenario("isolation", cartSteps.slice(0, 4));
    const result = await waitForBatch(await startBatch({ scenarioId, iterations: 3, concurrency: 1 }));
    expect(result.counts.passed).toBe(3);
  });

  it("records failures without corrupting the batch", async () => {
    const scenarioId = await createScenario("flaky", [
      { id: "f", type: "NAVIGATE", url: "/flaky" },
      { id: "h", type: "ASSERT_VISIBLE", target: { strategy: "role", value: "heading", name: "Flaky page loaded" }, timeoutMs: 1000 },
    ]);
    const batchId = await startBatch({ scenarioId, iterations: 4, concurrency: 1 });
    const result = await waitForBatch(batchId);
    expect(result.batch.status).toBe("COMPLETED");
    expect(result.counts).toMatchObject({ passed: 2, failed: 2, total: 4 });
    const runs = await runsOf(batchId);
    expect(runs.filter((r) => r.status === "FAILED").every((r) => r.errorCategory === "SITE_ERROR" && /HTTP 503/.test(r.errorMessage ?? ""))).toBe(true);
    const csv = await c.get(`/reports?batchId=${batchId}&format=csv&level=steps`);
    const rows = (csv.raw as string).trim().split("\r\n");
    expect(rows).toHaveLength(1 + 4 * 2); // header + one row per step per run
    expect(rows.filter((r) => r.includes(",SKIPPED,"))).toHaveLength(2); // assertions after failed navigations
  });

  it("classifies assertion failures and captures a failure screenshot", async () => {
    const scenarioId = await createScenario("bad-assert", [
      { id: "h", type: "NAVIGATE", url: "/" },
      { id: "t", type: "ASSERT_TEXT", target: { strategy: "role", value: "heading", name: "Welcome to Demo Shop" }, expected: "Closed for business", timeoutMs: 500 },
    ]);
    const batchId = await startBatch({ scenarioId, iterations: 1 });
    await waitForBatch(batchId);
    const [run] = await runsOf(batchId);
    expect(run).toMatchObject({ status: "FAILED", errorCategory: "ASSERTION" });
    const steps = (await c.get(`/runs/${run!.id}/steps`)).body.items;
    expect(steps[1].detail).toMatchObject({ expected: "Closed for business", actual: "Welcome to Demo Shop" });
    expect(steps[1].artifacts).toHaveLength(1);
  });
});

describe("quick start", () => {
  it("runs the starter scenario of a self-declared website end to end", async () => {
    const qs = await c.post("/quick-start", { url: `localhost:${sitePort}`, attestation: true });
    expect(qs.status, JSON.stringify(qs.body)).toBe(201);
    const r = await c.post("/batches", { scenarioId: qs.body.scenarioId, iterations: 2, concurrency: 2 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const result = await waitForBatch(r.body.batch.id);
    expect(result.counts).toMatchObject({ passed: 2, total: 2 });
  });
});

describe("network guard compatibility", () => {
  it("completes the sandbox checkout (form POST + same-site 303 redirect)", async () => {
    const scenarioId = await createScenario("checkout", [
      ...cartSteps.slice(0, 3),
      { id: "c", type: "NAVIGATE", url: "/checkout" },
      { id: "n", type: "TYPE", target: { strategy: "label", value: "Full name" }, text: "Ada Tester" },
      { id: "e", type: "TYPE", target: { strategy: "label", value: "Email" }, text: "ada@example.com" },
      { id: "d", type: "TYPE", target: { strategy: "label", value: "Address" }, text: "1 QA Street" },
      { id: "o", type: "CLICK", target: { strategy: "role", value: "button", name: "Place order" } },
      { id: "u", type: "ASSERT_URL", expected: "/order/confirmed", match: "pathEquals" },
      { id: "t", type: "ASSERT_TEXT", target: { strategy: "testId", value: "confirmation" }, expected: "for Ada Tester is confirmed" },
    ]);
    const batchId = await startBatch({ scenarioId, iterations: 1 });
    const result = await waitForBatch(batchId);
    expect(result.counts.passed).toBe(1);
  });
});

describe("cancellation", () => {
  it("stops a running batch at the current step and cancels queued runs", async () => {
    const scenarioId = await createScenario("slow", [
      { id: "h", type: "NAVIGATE", url: "/" },
      { id: "w", type: "WAIT", durationMs: 60_000, timeoutMs: 120_000 },
    ]);
    const batchId = await startBatch({ scenarioId, iterations: 3, concurrency: 1 });
    // Wait until the first run is executing its WAIT step.
    const end = Date.now() + 30_000;
    for (;;) {
      const runs = await runsOf(batchId);
      const running = runs.find((r) => r.status === "RUNNING");
      if (running && (await prisma.stepResult.count({ where: { runId: running.id } })) >= 1) break;
      if (Date.now() > end) throw new Error("run never started");
      await new Promise((r) => setTimeout(r, 200));
    }
    const t0 = Date.now();
    expect((await c.post(`/batches/${batchId}/cancel`)).status).toBe(200);
    const result = await waitForBatch(batchId, 20_000);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(result.batch.status).toBe("CANCELLED");
    const runs = await runsOf(batchId);
    expect(runs.map((r) => r.status)).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    const steps = (await c.get(`/runs/${runs[0]!.id}/steps`)).body.items;
    expect(steps.map((s: { status: string }) => s.status)).toEqual(["PASSED", "CANCELLED"]);
  });
});

describe("security enforcement in the browser", () => {
  it("blocks redirects to unauthorized domains", async () => {
    const scenarioId = await createScenario("redirect", [{ id: "r", type: "NAVIGATE", url: "/redirect-external" }]);
    const batchId = await startBatch({ scenarioId, iterations: 1 });
    await waitForBatch(batchId);
    const [run] = await runsOf(batchId);
    expect(run).toMatchObject({ status: "FAILED", errorCategory: "SECURITY" });
    const detail = (await c.get(`/runs/${run!.id}`)).body.run;
    expect(detail.observed.blockedRequests[0]).toMatchObject({ url: "https://example.com/", isNavigation: true });
  });

  it("blocks clicks that navigate off the authorized domain", async () => {
    const scenarioId = await createScenario("external-link", [
      { id: "o", type: "NAVIGATE", url: "/link-external" },
      { id: "c", type: "CLICK", target: { strategy: "role", value: "link", name: "Leave the shop" } },
      { id: "w", type: "WAIT", durationMs: 500 },
    ]);
    const batchId = await startBatch({ scenarioId, iterations: 1 });
    await waitForBatch(batchId);
    const [run] = await runsOf(batchId);
    expect(run).toMatchObject({ status: "FAILED", errorCategory: "SECURITY" });
  });

  it("re-checks domain authorization in the worker before every run", async () => {
    const scenarioId = await createScenario("revoked", [{ id: "h", type: "NAVIGATE", url: "/" }]);
    await runWorker.pause();
    try {
      const batchId = await startBatch({ scenarioId, iterations: 1 });
      const d = await c.get(`/domains?projectId=${projectId}`);
      await prisma.verifiedDomain.update({ where: { id: d.body.items[0].id }, data: { status: "REVOKED" } });
      runWorker.resume();
      await waitForBatch(batchId);
      const [run] = await runsOf(batchId);
      expect(run).toMatchObject({ status: "FAILED", errorCategory: "SECURITY" });
      expect((await c.get(`/runs/${run!.id}`)).body.run.observed).toBeNull(); // no browser was launched
    } finally {
      runWorker.resume();
      await prisma.verifiedDomain.updateMany({ where: { projectId }, data: { status: "VERIFIED" } });
    }
  });
});

describe("proxy profiles", () => {
  async function createProxy(body: Record<string, unknown>) {
    const r = await c.post("/proxy-profiles", { projectId, name: "Local", type: "HTTP", host: "127.0.0.1", regionLabel: "Local lab", ...body });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.profile.id as string;
  }

  it("tests connectivity and reports the observed egress IP", async () => {
    const id = await createProxy({ port: proxyPort });
    const r = await c.post(`/proxy-profiles/${id}/test`);
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ ok: true, egressIp: "127.0.0.1" });
    expect(r.body.profile.lastTest).toMatchObject({ ok: true, egressIp: "127.0.0.1" });
  });

  it("authenticates with stored credentials and reports auth failures", async () => {
    const good = await createProxy({ port: authProxyPort, username: "qa", password: "pa55word" });
    expect((await c.post(`/proxy-profiles/${good}/test`)).body.result.ok).toBe(true);
    const bad = await createProxy({ port: authProxyPort, username: "qa", password: "wrong" });
    const r = await c.post(`/proxy-profiles/${bad}/test`);
    expect(r.body.result.ok).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain("wrong");
  });

  it("reports unreachable proxies as network failures", async () => {
    const id = await createProxy({ port: 1 });
    const r = await c.post(`/proxy-profiles/${id}/test`);
    expect(r.body.result).toMatchObject({ ok: false, errorCategory: "NETWORK" });
    expect(r.body.result.error).toMatch(/ERR_PROXY_CONNECTION_FAILED|ECONNREFUSED|proxy/i);
  });

  it("routes runs through the selected proxy and records the configuration", async () => {
    const id = await createProxy({ port: authProxyPort, username: "qa", password: "pa55word" });
    const before = authProxy.requests;
    const scenarioId = await createScenario("via-proxy", cartSteps.slice(0, 4));
    const batchId = await startBatch({ scenarioId, iterations: 2, concurrency: 2, proxyProfileId: id });
    const result = await waitForBatch(batchId);
    expect(result.counts.passed).toBe(2);
    expect(authProxy.requests - before).toBeGreaterThanOrEqual(2);
    const [run] = await runsOf(batchId);
    const detail = (await c.get(`/runs/${run!.id}`)).body.run;
    expect(detail.observed.proxy).toEqual({ server: `127.0.0.1:${authProxyPort}`, regionLabel: "Local lab" });
    expect(result.batch.configSnapshot.proxy).toMatchObject({ host: "127.0.0.1", port: authProxyPort });
    expect(JSON.stringify(result)).not.toContain("pa55word");
  });

  it("fails runs with a NETWORK error when the proxy is down", async () => {
    const id = await createProxy({ port: 1 });
    const scenarioId = await createScenario("proxy-down", [{ id: "h", type: "NAVIGATE", url: "/", timeoutMs: 5000 }]);
    const batchId = await startBatch({ scenarioId, iterations: 1, proxyProfileId: id });
    await waitForBatch(batchId);
    const [run] = await runsOf(batchId);
    expect(run).toMatchObject({ status: "FAILED", errorCategory: "NETWORK" });
  });
});

describe("browser engines and device emulation", () => {
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    it.skipIf(!engines.includes(engine))(`runs on ${engine}`, async () => {
      const p = await c.post("/browser-profiles", { projectId, name: `${engine} desktop`, engine });
      const scenarioId = await createScenario(`engine-${engine}`, cartSteps.slice(0, 4));
      const batchId = await startBatch({ scenarioId, iterations: 1, browserProfileId: p.body.profile.id });
      const result = await waitForBatch(batchId);
      expect(result.counts.passed).toBe(1);
      const [run] = await runsOf(batchId);
      expect((await c.get(`/runs/${run!.id}`)).body.run.observed.engine).toBe(engine);
    });
  }

  it("applies device presets", async () => {
    const p = await c.post("/browser-profiles", { projectId, name: "Pixel 5", engine: "chromium", devicePreset: "Pixel 5" });
    expect(p.body.profile).toMatchObject({ viewportWidth: 393, viewportHeight: 727, isMobile: true });
    const scenarioId = await createScenario("mobile", [{ id: "h", type: "NAVIGATE", url: "/" }]);
    const batchId = await startBatch({ scenarioId, iterations: 1, browserProfileId: p.body.profile.id });
    await waitForBatch(batchId);
    const [run] = await runsOf(batchId);
    const observed = (await c.get(`/runs/${run!.id}`)).body.run.observed;
    expect(observed.viewport).toEqual({ width: 393, height: 727 });
    expect(observed.userAgent).toMatch(/Pixel 5/);
  });

  it.skipIf(engines.includes("firefox"))("reports a missing engine as an infrastructure error without retrying", async () => {
    const p = await c.post("/browser-profiles", { projectId, name: "Firefox", engine: "firefox" });
    const scenarioId = await createScenario("no-firefox", [{ id: "h", type: "NAVIGATE", url: "/" }]);
    const batchId = await startBatch({ scenarioId, iterations: 1, browserProfileId: p.body.profile.id });
    await waitForBatch(batchId);
    const [run] = (await c.get(`/batches/${batchId}/runs`)).body.items;
    expect(run).toMatchObject({ status: "FAILED", errorCategory: "INFRASTRUCTURE", attempt: 1 });
    expect(run.errorMessage).toMatch(/not installed/);
  });
});
