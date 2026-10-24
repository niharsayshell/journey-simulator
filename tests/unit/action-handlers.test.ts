/**
 * Scenario interpreter + action handlers, exercised against the bundled Demo
 * Shop in a real (headless) Chromium page.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { scenarioDefinitionSchema, type ScenarioDefinitionInput } from "@js/shared";
import { runScenario } from "@js/scenario-engine";
import { createDemoSite } from "../../apps/demo-site/src/server";

let site: ReturnType<typeof createDemoSite>;
let origin: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  site = createDemoSite({ port: 0 });
  origin = `http://localhost:${await site.listen()}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await site?.close();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
});
afterEach(async () => {
  await context.close();
});

const def = (steps: ScenarioDefinitionInput["steps"], settings: ScenarioDefinitionInput["settings"] = {}) =>
  scenarioDefinitionSchema.parse({ startUrl: `${origin}/`, settings, steps });

describe("action handlers", () => {
  it("NAVIGATE resolves relative paths and records navigation history", async () => {
    const r = await runScenario({ page, definition: def([{ id: "a", type: "NAVIGATE", url: "/products" }]) });
    expect(r.status).toBe("PASSED");
    expect(r.steps[0]!.detail).toMatchObject({ httpStatus: 200 });
    expect(r.navigationUrls).toEqual([`${origin}/products`]);
  });

  it("NAVIGATE to an HTTP error page is a SITE_ERROR", async () => {
    const r = await runScenario({ page, definition: def([{ id: "a", type: "NAVIGATE", url: "/error" }]) });
    expect(r.status).toBe("FAILED");
    expect(r.errorCategory).toBe("SITE_ERROR");
    expect(r.steps[0]!.errorMessage).toMatch(/HTTP 500/);
  });

  it("CLICK, SELECT, TYPE and assertions drive a full checkout", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/products/aurora-lamp" },
        { id: "2", type: "SELECT", target: { strategy: "label", value: "Quantity" }, option: "3" },
        { id: "3", type: "CLICK", target: { strategy: "role", value: "button", name: "Add to cart" } },
        { id: "4", type: "ASSERT_VISIBLE", target: { strategy: "role", value: "status" } },
        { id: "5", type: "ASSERT_TEXT", target: { strategy: "testId", value: "cart-count" }, expected: "3", match: "equals" },
        { id: "6", type: "NAVIGATE", url: "/checkout" },
        { id: "7", type: "TYPE", target: { strategy: "label", value: "Full name" }, text: "Grace", keyDelayMs: 5 },
        { id: "8", type: "TYPE", target: { strategy: "label", value: "Email" }, text: "g@example.com" },
        { id: "9", type: "TYPE", target: { strategy: "label", value: "Address" }, text: "Street 1" },
        { id: "10", type: "SELECT", target: { strategy: "label", value: "Shipping method" }, option: "Express (1 day)" },
        { id: "11", type: "CLICK", target: { strategy: "role", value: "button", name: "Place order" } },
        { id: "12", type: "ASSERT_URL", expected: "/order/confirmed", match: "pathEquals" },
        { id: "13", type: "ASSERT_TEXT", target: { strategy: "testId", value: "confirmation" }, expected: "express" },
      ]),
    });
    expect(r.steps.map((s) => s.status)).toEqual(Array(13).fill("PASSED"));
    expect(r.status).toBe("PASSED");
  });

  it("HOVER, SCROLL (pixels and element) and WAIT succeed", async () => {
    const r = await runScenario({
      page,
      random: () => 0.5,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "HOVER", target: { strategy: "role", value: "link", name: "Shop now" } },
        { id: "3", type: "SCROLL", deltaY: 600, steps: 3 },
        { id: "4", type: "SCROLL", target: { strategy: "css", value: "#footer" } },
        { id: "5", type: "WAIT", durationMs: 100, randomMaxMs: 300 },
      ]),
    });
    expect(r.status).toBe("PASSED");
    expect(r.steps[4]!.detail).toMatchObject({ waitedMs: 200 });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  it("failed assertions are ASSERTION errors with expected/actual detail", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "ASSERT_TEXT", target: { strategy: "role", value: "heading", name: "Welcome to Demo Shop" }, expected: "Goodbye", timeoutMs: 500 },
        { id: "3", type: "NAVIGATE", url: "/products" },
      ]),
    });
    expect(r.status).toBe("FAILED");
    expect(r.errorCategory).toBe("ASSERTION");
    expect(r.steps[1]!.detail).toMatchObject({ expected: "Goodbye", actual: "Welcome to Demo Shop" });
    expect(r.steps[2]!.status).toBe("SKIPPED");
  });

  it("ASSERT_VISIBLE negate passes for hidden elements", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/products/terra-planter" },
        { id: "2", type: "ASSERT_VISIBLE", target: { strategy: "text", value: "Added to cart" }, negate: true, timeoutMs: 500 },
      ]),
    });
    expect(r.status).toBe("PASSED");
  });

  it("CONTINUE policy keeps executing but the run still fails", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "CLICK", target: { strategy: "testId", value: "missing" }, timeoutMs: 300, onFailure: "CONTINUE" },
        { id: "3", type: "ASSERT_URL", expected: "/", match: "pathEquals" },
      ]),
    });
    expect(r.steps.map((s) => s.status)).toEqual(["PASSED", "FAILED", "PASSED"]);
    expect(r.status).toBe("FAILED");
    expect(r.errorCategory).toBe("TIMEOUT");
  });

  it("retries a failing step the configured number of times", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "CLICK", target: { strategy: "testId", value: "missing" }, timeoutMs: 200, retries: 2 },
      ]),
    });
    expect(r.steps[1]!.attempts).toBe(3);
  });

  it("captures screenshots via the hook for SCREENSHOT steps and failures", async () => {
    const shots: Array<{ stepIndex: number; reason: string }> = [];
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "SCREENSHOT", fullPage: true },
        { id: "3", type: "ASSERT_URL", expected: "/nowhere", match: "pathEquals", timeoutMs: 200 },
      ]),
      hooks: {
        captureScreenshot: async (p, info) => {
          const buf = await p.screenshot({ fullPage: info.fullPage });
          expect(buf.subarray(1, 4).toString()).toBe("PNG");
          shots.push(info);
          return `shot-${shots.length}`;
        },
      },
    });
    expect(shots).toEqual([
      { stepIndex: 1, fullPage: true, reason: "step" },
      { stepIndex: 2, fullPage: false, reason: "failure" },
    ]);
    expect(r.steps[1]!.artifactIds).toEqual(["shot-1"]);
    expect(r.steps[2]!.artifactIds).toEqual(["shot-2"]);
  });

  it("security violations fail the step and stop the run regardless of policy", async () => {
    const r = await runScenario({
      page,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/", onFailure: "CONTINUE" },
        { id: "2", type: "NAVIGATE", url: "/products" },
      ]),
      hooks: { securityViolation: () => "Blocked navigation to https://evil.example/" },
    });
    expect(r.status).toBe("FAILED");
    expect(r.errorCategory).toBe("SECURITY");
    expect(r.steps[1]!.status).toBe("SKIPPED");
  });
});

describe("cancellation and time limits", () => {
  it("cancels during a step and never reports success", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const started = Date.now();
    const r = await runScenario({
      page,
      signal: ac.signal,
      definition: def([
        { id: "1", type: "NAVIGATE", url: "/" },
        { id: "2", type: "WAIT", durationMs: 10_000 },
        { id: "3", type: "NAVIGATE", url: "/products" },
      ]),
    });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.status).toBe("CANCELLED");
    expect(r.steps.map((s) => s.status)).toEqual(["PASSED", "CANCELLED", "SKIPPED"]);
  });

  it("an already-aborted signal runs nothing", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runScenario({ page, signal: ac.signal, definition: def([{ id: "1", type: "NAVIGATE", url: "/" }]) });
    expect(r.status).toBe("CANCELLED");
    expect(r.steps[0]!.status).toBe("SKIPPED");
  });

  it("enforces the maximum run duration as TIMED_OUT", async () => {
    const r = await runScenario({
      page,
      definition: def([{ id: "1", type: "WAIT", durationMs: 60_000, timeoutMs: 120_000 }], { maxDurationMs: 5000 }),
    });
    expect(r.status).toBe("TIMED_OUT");
    expect(r.errorCategory).toBe("TIMEOUT");
  }, 15_000);

  it("idles until the intended session duration", async () => {
    const r = await runScenario({ page, definition: def([{ id: "1", type: "NAVIGATE", url: "/" }], { minSessionDurationMs: 1500 }) });
    expect(r.status).toBe("PASSED");
    expect(r.durationMs).toBeGreaterThanOrEqual(1500);
  });
});
