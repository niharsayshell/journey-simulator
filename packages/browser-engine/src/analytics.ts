/**
 * Detects analytics / tag requests made by the page so a run can report what
 * was actually sent to analytics tools (for tracking QA). Read-only: requests
 * are never modified or generated.
 */

export type AnalyticsVendor = "GA4" | "UNIVERSAL_ANALYTICS" | "GOOGLE_TAG" | "META_PIXEL" | "MICROSOFT_CLARITY";

export interface AnalyticsHit {
  vendor: AnalyticsVendor;
  /** Measurement / container / pixel id when present (G-XXXX, GTM-XXXX, UA-…). */
  id?: string;
  /** Event names in this request (GA4 batches several). */
  events: string[];
  /** Page the hit reported (dl / document location). */
  page?: string;
  host: string;
  /** HTTP status, or 0 when the request failed / was blocked. */
  status: number;
  outcome: "sent" | "failed" | "blocked";
  at: string;
}

function params(raw: string): URLSearchParams {
  try {
    return new URLSearchParams(raw);
  } catch {
    return new URLSearchParams();
  }
}

/** Classify a request; returns null for non-analytics traffic. */
export function detectAnalyticsHit(
  url: string,
  postData: string | null,
): Omit<AnalyticsHit, "status" | "outcome" | "at"> | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const q = u.searchParams;
  const host = u.hostname;
  const tid = q.get("tid") ?? undefined;

  // GA4 — also matches server-side tagging on first-party hosts.
  if (/\/g\/collect$/.test(u.pathname) && (tid?.startsWith("G-") || /google-analytics\.com|analytics\.google\.com/.test(host))) {
    const events = new Set<string>();
    const en = q.get("en");
    if (en) events.add(en);
    // Batched hits: one event per line in the POST body.
    for (const line of (postData ?? "").split(/\r?\n/)) {
      const e = params(line).get("en");
      if (e) events.add(e);
    }
    return { vendor: "GA4", id: tid, events: [...events], page: q.get("dl") ?? undefined, host };
  }
  if (/google-analytics\.com$/.test(host) && /^\/(r\/|j\/)?collect$/.test(u.pathname)) {
    const p = postData ? params(postData) : q;
    return { vendor: "UNIVERSAL_ANALYTICS", id: p.get("tid") ?? tid, events: [p.get("t") ?? "hit"], page: p.get("dl") ?? undefined, host };
  }
  if (host === "www.googletagmanager.com" && /^\/(gtm\.js|gtag\/js)$/.test(u.pathname)) {
    return { vendor: "GOOGLE_TAG", id: q.get("id") ?? undefined, events: ["tag loaded"], host };
  }
  if (/(^|\.)facebook\.com$/.test(host) && u.pathname === "/tr") {
    return { vendor: "META_PIXEL", id: q.get("id") ?? undefined, events: [q.get("ev") ?? "event"], page: q.get("dl") ?? undefined, host };
  }
  if (/(^|\.)clarity\.ms$/.test(host) && u.pathname.startsWith("/collect")) {
    return { vendor: "MICROSOFT_CLARITY", events: ["collect"], host };
  }
  return null;
}
