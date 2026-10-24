import { describe, expect, it } from "vitest";
import { collectNavigationUrls, createBatchInput, createDomainInput, scenarioDefinitionSchema, stepSchema } from "@js/shared";

const valid = {
  startUrl: "https://shop.example.com/",
  steps: [
    { id: "a", type: "NAVIGATE", url: "/products" },
    { id: "b", type: "CLICK", target: { strategy: "role", value: "button", name: "Buy" } },
    { id: "c", type: "ASSERT_TEXT", target: { strategy: "testId", value: "total" }, expected: "$10" },
  ],
};

describe("scenario definition schema", () => {
  it("accepts a valid definition and applies defaults", () => {
    const r = scenarioDefinitionSchema.parse(valid);
    expect(r.settings.maxDurationMs).toBe(300_000);
    expect(r.steps[0]).toMatchObject({ timeoutMs: 10_000, retries: 0, onFailure: "STOP", screenshot: "ON_FAILURE", waitUntil: "load" });
  });

  it("rejects an empty step list", () => {
    expect(scenarioDefinitionSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
  });

  it("rejects duplicate step ids", () => {
    const r = scenarioDefinitionSchema.safeParse({ ...valid, steps: [valid.steps[0], { ...valid.steps[0] }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/Duplicate/);
  });

  it("rejects non-http start URLs", () => {
    for (const startUrl of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x.com/"]) {
      expect(scenarioDefinitionSchema.safeParse({ ...valid, startUrl }).success).toBe(false);
    }
  });

  it("rejects unknown step types, including ones that would run code", () => {
    expect(stepSchema.safeParse({ id: "x", type: "EVALUATE", script: "alert(1)" }).success).toBe(false);
    expect(stepSchema.safeParse({ id: "x", type: "CONDITION" }).success).toBe(false);
  });

  it("strips unknown fields so no arbitrary code can be smuggled into a step", () => {
    const r = stepSchema.parse({ id: "x", type: "CLICK", target: { strategy: "css", value: "#a" }, script: "fetch('//evil')" });
    expect(r).not.toHaveProperty("script");
  });

  it("validates role locators", () => {
    expect(stepSchema.safeParse({ id: "x", type: "CLICK", target: { strategy: "role", value: "not-a-role" } }).success).toBe(false);
  });

  it("enforces bounds on timeouts and retries", () => {
    expect(stepSchema.safeParse({ id: "x", type: "WAIT", durationMs: 10, timeoutMs: 50 }).success).toBe(false);
    expect(stepSchema.safeParse({ id: "x", type: "WAIT", durationMs: 10, retries: 9 }).success).toBe(false);
  });

  it("rejects WAIT ranges where max < min", () => {
    const r = scenarioDefinitionSchema.safeParse({ ...valid, steps: [{ id: "w", type: "WAIT", durationMs: 1000, randomMaxMs: 10 }] });
    expect(r.success).toBe(false);
  });

  it("collects absolute navigation URLs for pre-flight authorization", () => {
    const def = scenarioDefinitionSchema.parse({ ...valid, steps: [...valid.steps, { id: "z", type: "NAVIGATE", url: "https://other.example.org/x" }] });
    expect(collectNavigationUrls(def).map((u) => u.host)).toEqual(["shop.example.com", "shop.example.com", "other.example.org"]);
  });
});

describe("API input schemas", () => {
  it("rejects schemes or paths in domain hosts", () => {
    expect(createDomainInput.safeParse({ projectId: "p", host: "https://a.com" }).success).toBe(false);
    expect(createDomainInput.safeParse({ projectId: "p", host: "a.com/x" }).success).toBe(false);
    expect(createDomainInput.parse({ projectId: "p", host: "Shop.Example.com:8443" }).host).toBe("shop.example.com:8443");
  });

  it("defaults batches to a single fresh-session run", () => {
    expect(createBatchInput.parse({ scenarioId: "s" })).toMatchObject({ iterations: 1, concurrency: 1, sessionMode: "FRESH_SESSION", dryRun: false });
  });
});
