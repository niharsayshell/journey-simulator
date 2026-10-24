import { describe, expect, it } from "vitest";
import { classifyError, StepFailure } from "@js/scenario-engine";
import { extractIp } from "@js/browser-engine";

describe("error classification", () => {
  it("keeps explicit categories", () => {
    expect(classifyError(new StepFailure("SITE_ERROR", "500"), "NAVIGATE").category).toBe("SITE_ERROR");
  });
  it("maps network errors", () => {
    expect(classifyError(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://x"), "NAVIGATE").category).toBe("NETWORK");
  });
  it("maps policy blocks to SECURITY", () => {
    expect(classifyError(new Error("page.goto: net::ERR_BLOCKED_BY_CLIENT"), "NAVIGATE").category).toBe("SECURITY");
  });
  it("maps timeouts by step kind", () => {
    const e = Object.assign(new Error("locator.click: Timeout 100ms exceeded."), { name: "TimeoutError" });
    expect(classifyError(e, "CLICK").category).toBe("TIMEOUT");
    expect(classifyError(e, "ASSERT_VISIBLE").category).toBe("ASSERTION");
  });
  it("maps closed browsers to INFRASTRUCTURE", () => {
    expect(classifyError(new Error("Target page, context or browser has been closed"), "CLICK").category).toBe("INFRASTRUCTURE");
  });
});

describe("egress IP extraction", () => {
  it("reads JSON and plain bodies", () => {
    expect(extractIp('{"ip":"203.0.113.9"}')).toBe("203.0.113.9");
    expect(extractIp("<pre>198.51.100.4</pre>")).toBe("198.51.100.4");
    expect(extractIp("nothing")).toBeUndefined();
  });
});
