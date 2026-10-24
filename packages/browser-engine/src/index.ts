import { chromium, firefox, webkit, devices, type Browser, type BrowserContext, type BrowserType, type Page, type Route } from "playwright";
import { existsSync } from "node:fs";
import type { BrowserEngine, ProxyType } from "@js/shared";
import {
  assertPublicDestination,
  matchesAuthorizedHost,
  parseTargetUrl,
  UrlPolicyError,
  type AuthorizedHost,
  type NetworkPolicy,
  type Resolver,
} from "@js/security";

/** Snapshot of the browser profile actually applied to a run. */
export interface BrowserProfileConfig {
  engine: BrowserEngine;
  devicePreset?: string | null;
  viewportWidth: number;
  viewportHeight: number;
  locale: string;
  timezone: string;
  colorScheme: "light" | "dark" | "no-preference";
  userAgent?: string | null;
  isMobile?: boolean;
}

export const DEFAULT_BROWSER_PROFILE: BrowserProfileConfig = {
  engine: "chromium",
  viewportWidth: 1366,
  viewportHeight: 768,
  locale: "en-US",
  timezone: "UTC",
  colorScheme: "light",
};

export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** Device presets offered in the UI (subset of Playwright's registry). */
export const DEVICE_PRESETS = [
  "Desktop Chrome",
  "Desktop Firefox",
  "Desktop Safari",
  "Desktop Edge",
  "iPhone 13",
  "iPhone 14 Pro Max",
  "iPhone SE",
  "iPad Mini",
  "iPad Pro 11",
  "Pixel 5",
  "Pixel 7",
  "Galaxy S9+",
  "Galaxy Tab S4",
] as const;

export function describeDevicePreset(name: string) {
  const d = devices[name];
  if (!d) return null;
  return {
    name,
    viewportWidth: d.viewport.width,
    viewportHeight: d.viewport.height,
    isMobile: Boolean(d.isMobile),
    userAgent: d.userAgent,
    defaultBrowserType: d.defaultBrowserType as BrowserEngine,
  };
}

const ENGINES: Record<BrowserEngine, BrowserType> = { chromium, firefox, webkit };

/** Which engines have a browser binary installed on this worker. */
export function availableEngines(): BrowserEngine[] {
  return (Object.keys(ENGINES) as BrowserEngine[]).filter((e) => {
    try {
      return existsSync(ENGINES[e].executablePath());
    } catch {
      return false;
    }
  });
}

export function toPlaywrightProxy(p: ProxyConfig) {
  const scheme = p.type === "SOCKS5" ? "socks5" : p.type === "HTTPS" ? "https" : "http";
  return {
    server: `${scheme}://${p.host}:${p.port}`,
    username: p.username || undefined,
    password: p.password || undefined,
  };
}

export class BrowserUnavailableError extends Error {}

export interface GuardOptions {
  authorizedHosts: AuthorizedHost[];
  policy: NetworkPolicy;
  /** Header added only to requests going to authorized hosts. */
  testHeader?: { name: string; value: string } | null;
  /** Allow sub-resources (CDN scripts, fonts, images) from public third-party hosts. */
  allowThirdPartySubresources?: boolean;
  resolver?: Resolver;
  requestTimeoutMs?: number;
}

/** Map a Node-side fetch failure to the closest browser network error code. */
function networkErrorCode(err: unknown): "connectionrefused" | "namenotresolved" | "timedout" | "connectionreset" | "failed" {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/i.test(msg)) return "connectionrefused";
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return "namenotresolved";
  if (/timed? ?out|ETIMEDOUT/i.test(msg)) return "timedout";
  if (/ECONNRESET|socket hang up/i.test(msg)) return "connectionreset";
  return "failed";
}

export interface NetworkGuard {
  /** Blocked requests (for logs and reporting). */
  blocked: Array<{ url: string; reason: string; isNavigation: boolean }>;
  /** First blocked top-level navigation, which fails the run. */
  navigationViolation(): string | null;
}

/**
 * Installs a context-wide request interceptor that enforces the domain
 * authorization and SSRF policy for every request the page makes, including
 * redirects and navigations triggered by page scripts.
 */
export async function installNetworkGuard(context: BrowserContext, opts: GuardOptions): Promise<NetworkGuard> {
  const blocked: NetworkGuard["blocked"] = [];
  let violation: string | null = null;
  const dnsCache = new Map<string, Promise<void>>();

  const checkPublic = (u: URL) => {
    const key = `${u.hostname}:${u.port}`;
    let p = dnsCache.get(key);
    if (!p) {
      p = assertPublicDestination(u, opts.policy, opts.resolver).then(() => undefined);
      dnsCache.set(key, p);
    }
    return p;
  };

  const assertAllowed = async (u: URL, isNavigation: boolean) => {
    const authorized = matchesAuthorizedHost(u, opts.authorizedHosts);
    if (!authorized && (isNavigation || !opts.allowThirdPartySubresources)) {
      throw new UrlPolicyError(`${u.host} is not an authorized domain`, "UNAUTHORIZED_HOST");
    }
    await checkPublic(u);
    return authorized;
  };

  // Browsers follow HTTP redirects internally without calling the route
  // handler again, so requests are fetched here with redirects disabled and
  // every Location header is validated before the browser may follow it.
  await context.route("**/*", async (route: Route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith("data:") || raw.startsWith("blob:") || raw === "about:blank") return route.continue();
    const isNavigation = request.isNavigationRequest() && request.frame().parentFrame() === null;
    const block = (url: string, err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      blocked.push({ url: url.slice(0, 300), reason, isNavigation });
      if (isNavigation && !violation) violation = `Blocked navigation to ${url.slice(0, 200)}: ${reason}`;
      return route.abort("blockedbyclient").catch(() => undefined);
    };

    let authorized: boolean;
    try {
      authorized = await assertAllowed(parseTargetUrl(raw), isNavigation);
    } catch (err) {
      return block(raw, err);
    }
    const headers =
      authorized && opts.testHeader ? { ...request.headers(), [opts.testHeader.name.toLowerCase()]: opts.testHeader.value } : undefined;

    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch({ maxRedirects: 0, headers, timeout: opts.requestTimeoutMs ?? 30_000 });
    } catch (err) {
      return route.abort(networkErrorCode(err)).catch(() => undefined);
    }
    const status = response.status();
    const location = response.headers()["location"];
    if (status >= 300 && status < 400 && location) {
      let target: URL;
      try {
        target = parseTargetUrl(new URL(location, raw).toString());
        await assertAllowed(target, isNavigation);
      } catch (err) {
        return block(new URL(location, raw).toString(), err);
      }
    }
    return route.fulfill({ response }).catch(() => undefined);
  });

  return { blocked, navigationViolation: () => violation };
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  guard: NetworkGuard;
  /** Facts about what was actually launched, for accurate reporting. */
  observed: { engine: BrowserEngine; browserVersion: string; userAgent: string; viewport: { width: number; height: number } | null };
  close(): Promise<void>;
}

export interface LaunchOptions {
  profile: BrowserProfileConfig;
  proxy?: ProxyConfig | null;
  guard: GuardOptions;
  headless?: boolean;
  /** Playwright's own launch timeout. */
  launchTimeoutMs?: number;
  /** Pass a storage state (RETURNING_SESSION mode). */
  storageState?: Parameters<Browser["newContext"]>[0] extends infer O ? (O extends { storageState?: infer S } ? S : never) : never;
}

/**
 * Launch an isolated browser for one run. Each run gets its own browser process
 * and a fresh context, so no cookies or storage leak between runs.
 */
export async function launchBrowserSession(opts: LaunchOptions): Promise<BrowserSession> {
  const type = ENGINES[opts.profile.engine];
  if (!type) throw new BrowserUnavailableError(`Unknown browser engine ${opts.profile.engine}`);
  if (!availableEngines().includes(opts.profile.engine)) {
    throw new BrowserUnavailableError(`Browser engine "${opts.profile.engine}" is not installed on this worker`);
  }

  const browser = await type.launch({
    headless: opts.headless ?? true,
    timeout: opts.launchTimeoutMs ?? 30_000,
    proxy: opts.proxy ? toPlaywrightProxy(opts.proxy) : undefined,
    // Firefox must not silently bypass the proxy for localhost.
    firefoxUserPrefs: opts.proxy ? { "network.proxy.allow_hijacking_localhost": true } : undefined,
    args:
      opts.profile.engine === "chromium" && opts.proxy
        ? ["--proxy-bypass-list=<-loopback>"] // route loopback through the proxy too, never around it
        : undefined,
  });

  let context: BrowserContext | undefined;
  try {
    const preset = opts.profile.devicePreset ? devices[opts.profile.devicePreset] : undefined;
    const presetOptions = preset ? { ...preset } : {};
    // Firefox does not support isMobile.
    if (opts.profile.engine === "firefox") delete (presetOptions as { isMobile?: boolean }).isMobile;
    delete (presetOptions as { defaultBrowserType?: string }).defaultBrowserType;

    context = await browser.newContext({
      ...presetOptions,
      viewport: { width: opts.profile.viewportWidth, height: opts.profile.viewportHeight },
      userAgent: opts.profile.userAgent || (presetOptions as { userAgent?: string }).userAgent,
      locale: opts.profile.locale,
      timezoneId: opts.profile.timezone,
      colorScheme: opts.profile.colorScheme,
      // Service workers can bypass request interception; block them so the guard sees every request.
      serviceWorkers: "block",
      acceptDownloads: false,
      storageState: opts.storageState,
    });
    const guard = await installNetworkGuard(context, opts.guard);
    const page = await context.newPage();
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "unknown");
    const ctx = context;
    return {
      browser,
      context: ctx,
      page,
      guard,
      observed: { engine: opts.profile.engine, browserVersion: browser.version(), userAgent, viewport: page.viewportSize() },
      async close() {
        await ctx.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    };
  } catch (err) {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw err;
  }
}

/**
 * Use a proxy through a real browser and report the egress IP. Uses the same
 * launch path as runs, so a passing test means runs will route the same way.
 */
export async function testProxyThroughBrowser(opts: {
  proxy: ProxyConfig;
  checkUrl: string;
  engine?: BrowserEngine;
  timeoutMs?: number;
}): Promise<{ ok: boolean; egressIp?: string; latencyMs?: number; error?: string; errorCategory?: "NETWORK" | "TIMEOUT" | "AUTH" | "INFRASTRUCTURE" }> {
  const engine = opts.engine ?? availableEngines()[0] ?? "chromium";
  const timeout = opts.timeoutMs ?? 20_000;
  let browser: Browser | undefined;
  try {
    browser = await ENGINES[engine].launch({
      headless: true,
      timeout,
      proxy: toPlaywrightProxy(opts.proxy),
      firefoxUserPrefs: { "network.proxy.allow_hijacking_localhost": true },
      args: engine === "chromium" ? ["--proxy-bypass-list=<-loopback>"] : undefined,
    });
  } catch (err) {
    return { ok: false, error: `Browser launch failed: ${(err as Error).message.split("\n")[0]}`, errorCategory: "INFRASTRUCTURE" };
  }
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const started = Date.now();
    const res = await page.goto(opts.checkUrl, { timeout, waitUntil: "domcontentloaded" });
    const latencyMs = Date.now() - started;
    const status = res?.status() ?? 0;
    if (status === 407) return { ok: false, latencyMs, error: "Proxy rejected the credentials (HTTP 407)", errorCategory: "AUTH" };
    if (status < 200 || status >= 300) return { ok: false, latencyMs, error: `Check URL returned HTTP ${status}`, errorCategory: "NETWORK" };
    const body = ((await res?.text()) ?? "").slice(0, 2000);
    return { ok: true, latencyMs, egressIp: extractIp(body) };
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0] ?? "unknown error";
    const category = /Timeout/i.test(msg) ? "TIMEOUT" : /407|AUTH|ERR_PROXY_AUTH/i.test(msg) ? "AUTH" : "NETWORK";
    return { ok: false, error: msg, errorCategory: category };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Accepts `{"ip":"1.2.3.4"}` (ipify, demo site) or a plain-text IP body. */
export function extractIp(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { ip?: unknown; origin?: unknown };
    const v = typeof parsed.ip === "string" ? parsed.ip : typeof parsed.origin === "string" ? parsed.origin : undefined;
    if (v) return v.slice(0, 64);
  } catch {
    /* not JSON */
  }
  const m = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/i);
  return m?.[0];
}
