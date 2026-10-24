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

describe("analytics hit detection", () => {
  it("parses GA4 hits, including batched events in the body", async () => {
    const { detectAnalyticsHit } = await import("@js/browser-engine");
    const hit = detectAnalyticsHit(
      "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=page_view&dl=https%3A%2F%2Fshop.example.com%2F%3Futm_source%3Dx",
      "en=scroll&epn.percent_scrolled=90\nen=user_engagement",
    );
    expect(hit).toMatchObject({ vendor: "GA4", id: "G-ABC123", events: ["page_view", "scroll", "user_engagement"], page: "https://shop.example.com/?utm_source=x" });
  });
  it("recognises server-side GA4 on first-party hosts, GTM and Meta Pixel, and ignores other traffic", async () => {
    const { detectAnalyticsHit } = await import("@js/browser-engine");
    expect(detectAnalyticsHit("https://shop.example.com/g/collect?tid=G-X1&en=purchase", null)?.vendor).toBe("GA4");
    expect(detectAnalyticsHit("https://shop.example.com/g/collect?foo=1", null)).toBeNull();
    expect(detectAnalyticsHit("https://www.googletagmanager.com/gtag/js?id=G-X1", null)).toMatchObject({ vendor: "GOOGLE_TAG", id: "G-X1" });
    expect(detectAnalyticsHit("https://www.facebook.com/tr?id=123&ev=PageView", null)).toMatchObject({ vendor: "META_PIXEL", events: ["PageView"] });
    expect(detectAnalyticsHit("https://shop.example.com/products", null)).toBeNull();
  });
});
