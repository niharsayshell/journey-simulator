import type { Locator as PwLocator, Page } from "playwright";
import { resolveStepUrl, type ErrorCategory, type Locator, type ScenarioDefinition, type Step, type StepStatus } from "@js/shared";
import { classifyError, StepFailure } from "./errors";

export interface StepOutcome {
  index: number;
  stepKey: string;
  type: Step["type"];
  label?: string;
  status: StepStatus;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  url?: string;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  detail?: Record<string, unknown>;
  /** Artifact ids produced by this step (screenshots). */
  artifactIds: string[];
}

export type RunOutcomeStatus = "PASSED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface RunOutcome {
  status: RunOutcomeStatus;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  steps: StepOutcome[];
  navigationUrls: string[];
  finalUrl?: string;
  durationMs: number;
}

export interface EngineHooks {
  /** Persist a step result as soon as it is known (for live dashboards). */
  onStepComplete?(outcome: StepOutcome): Promise<void> | void;
  /** Store a screenshot; returns an artifact id. Failures here must not fail the run. */
  captureScreenshot?(page: Page, info: { stepIndex: number; fullPage: boolean; reason: "step" | "failure" }): Promise<string | undefined>;
  /**
   * Returns a message if the network guard blocked something that must fail
   * the run (e.g. navigation to an unauthorized host). Checked after each step.
   */
  securityViolation?(): string | null;
}

export interface RunScenarioOptions {
  page: Page;
  definition: ScenarioDefinition;
  /** Abort to cancel the run (batch, run or step level cancellation). */
  signal?: AbortSignal;
  hooks?: EngineHooks;
  /** Deterministic randomness for WAIT.randomMaxMs (tests). */
  random?: () => number;
}

class CancelledError extends Error {
  constructor(public readonly reason: "cancelled" | "timeout") {
    super(reason === "timeout" ? "Run exceeded its maximum duration" : "Run was cancelled");
  }
}

/**
 * Deterministic interpreter: executes steps strictly in order, applying per-step
 * timeouts, retries and failure policies. It never evaluates user-supplied code.
 */
export async function runScenario(opts: RunScenarioOptions): Promise<RunOutcome> {
  const { page, definition, hooks = {} } = opts;
  const random = opts.random ?? Math.random;
  const runStart = Date.now();
  const navigationUrls: string[] = [];
  const steps: StepOutcome[] = [];

  // Combine external cancellation with the run's max duration.
  const internal = new AbortController();
  const deadline = setTimeout(() => internal.abort(new CancelledError("timeout")), definition.settings.maxDurationMs);
  const onExternalAbort = () => internal.abort(new CancelledError("cancelled"));
  if (opts.signal?.aborted) onExternalAbort();
  opts.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const signal = internal.signal;

  const onFrameNavigated = (frame: { url(): string; parentFrame(): unknown }) => {
    if (frame.parentFrame() === null) {
      const url = frame.url();
      if (url && url !== "about:blank" && navigationUrls[navigationUrls.length - 1] !== url) navigationUrls.push(url);
    }
  };
  page.on("framenavigated", onFrameNavigated as never);

  let status: RunOutcomeStatus = "PASSED";
  let errorCategory: ErrorCategory | undefined;
  let errorMessage: string | undefined;

  try {
    let stop = false;
    for (let index = 0; index < definition.steps.length; index++) {
      const step = definition.steps[index]!;
      if (stop) {
        steps.push(skipped(step, index, "Skipped because an earlier step stopped the run"));
        continue;
      }
      if (signal.aborted) {
        const reason = abortReason(signal);
        status = reason === "timeout" ? "TIMED_OUT" : "CANCELLED";
        errorCategory = reason === "timeout" ? "TIMEOUT" : "CANCELLED";
        errorMessage ??= abortMessage(signal);
        steps.push(skipped(step, index, errorMessage));
        stop = true;
        continue;
      }

      const outcome = await executeStep(page, step, index, definition, signal, hooks, random);
      steps.push(outcome);
      await safeHook(() => hooks.onStepComplete?.(outcome));

      if (outcome.status === "CANCELLED") {
        const reason = abortReason(signal);
        status = reason === "timeout" ? "TIMED_OUT" : "CANCELLED";
        errorCategory = reason === "timeout" ? "TIMEOUT" : "CANCELLED";
        errorMessage = outcome.errorMessage;
        stop = true;
      } else if (outcome.status === "FAILED") {
        // SECURITY failures always stop the run regardless of policy.
        if (step.onFailure === "STOP" || outcome.errorCategory === "SECURITY") {
          status = "FAILED";
          errorCategory = outcome.errorCategory;
          errorMessage = `Step ${index + 1} (${step.label ?? step.type}) failed: ${outcome.errorMessage ?? "unknown error"}`;
          stop = true;
        } else if (status === "PASSED") {
          // CONTINUE policy: the run keeps going but cannot be reported as passed.
          status = "FAILED";
          errorCategory = outcome.errorCategory;
          errorMessage = `Step ${index + 1} (${step.label ?? step.type}) failed: ${outcome.errorMessage ?? "unknown error"}`;
        }
      }
    }

    // Intended session duration: idle on the final page if we finished early.
    if (!stop && status !== "CANCELLED") {
      const remaining = definition.settings.minSessionDurationMs - (Date.now() - runStart);
      if (remaining > 0) {
        try {
          await abortableDelay(remaining, signal);
        } catch {
          const reason = abortReason(signal);
          status = reason === "timeout" ? "TIMED_OUT" : "CANCELLED";
          errorCategory = reason === "timeout" ? "TIMEOUT" : "CANCELLED";
          errorMessage = abortMessage(signal);
        }
      }
    }
  } finally {
    clearTimeout(deadline);
    opts.signal?.removeEventListener("abort", onExternalAbort);
    page.off("framenavigated", onFrameNavigated as never);
  }

  let finalUrl: string | undefined;
  try {
    finalUrl = page.isClosed() ? navigationUrls[navigationUrls.length - 1] : page.url();
  } catch {
    finalUrl = navigationUrls[navigationUrls.length - 1];
  }

  return { status, errorCategory, errorMessage, steps, navigationUrls, finalUrl, durationMs: Date.now() - runStart };
}

function skipped(step: Step, index: number, message: string): StepOutcome {
  const now = new Date();
  return {
    index,
    stepKey: step.id,
    type: step.type,
    label: step.label,
    status: "SKIPPED",
    attempts: 0,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    errorMessage: message,
    artifactIds: [],
  };
}

async function executeStep(
  page: Page,
  step: Step,
  index: number,
  def: ScenarioDefinition,
  signal: AbortSignal,
  hooks: EngineHooks,
  random: () => number,
): Promise<StepOutcome> {
  const startedAt = new Date();
  const artifactIds: string[] = [];
  let attempts = 0;
  let lastError: unknown;
  let detail: Record<string, unknown> | undefined;

  const maxAttempts = step.retries + 1;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const result = await raceAbort(runAction(page, step, def, random, signal, hooks, index, artifactIds), signal);
      detail = result ?? undefined;
      const violation = hooks.securityViolation?.();
      if (violation) throw new StepFailure("SECURITY", violation);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      if (signal.aborted || err instanceof CancelledError) break;
      if (err instanceof StepFailure && (err.category === "SECURITY" || err.category === "VALIDATION")) break;
      if (attempts < maxAttempts) await abortableDelay(250, signal).catch(() => undefined);
    }
  }

  const finishedAt = new Date();
  const url = currentUrl(page);
  if (lastError === undefined) {
    if (step.screenshot === "ALWAYS" && step.type !== "SCREENSHOT") await shot(page, hooks, index, false, "step", artifactIds);
    return {
      index,
      stepKey: step.id,
      type: step.type,
      label: step.label,
      status: "PASSED",
      attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      url,
      detail,
      artifactIds,
    };
  }

  if (signal.aborted || lastError instanceof CancelledError) {
    return {
      index,
      stepKey: step.id,
      type: step.type,
      label: step.label,
      status: "CANCELLED",
      attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      url,
      errorCategory: abortReason(signal) === "timeout" ? "TIMEOUT" : "CANCELLED",
      errorMessage: abortMessage(signal),
      artifactIds,
    };
  }

  const classified = classifyError(lastError, step.type);
  if (step.screenshot !== "NEVER") await shot(page, hooks, index, false, "failure", artifactIds);
  return {
    index,
    stepKey: step.id,
    type: step.type,
    label: step.label,
    status: "FAILED",
    attempts,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    url,
    errorCategory: classified.category,
    errorMessage: classified.message,
    detail: lastError instanceof StepFailure ? lastError.detail : undefined,
    artifactIds,
  };
}

async function shot(page: Page, hooks: EngineHooks, stepIndex: number, fullPage: boolean, reason: "step" | "failure", into: string[]) {
  if (!hooks.captureScreenshot || page.isClosed()) return;
  try {
    const id = await hooks.captureScreenshot(page, { stepIndex, fullPage, reason });
    if (id) into.push(id);
  } catch {
    /* screenshot problems never change a step outcome */
  }
}

export function buildLocator(page: Page, loc: Locator): PwLocator {
  let l: PwLocator;
  switch (loc.strategy) {
    case "role":
      l = page.getByRole(loc.value as Parameters<Page["getByRole"]>[0], {
        name: loc.name || undefined,
        exact: loc.exact,
      });
      break;
    case "label":
      l = page.getByLabel(loc.value, { exact: loc.exact });
      break;
    case "testId":
      l = page.getByTestId(loc.value);
      break;
    case "text":
      l = page.getByText(loc.value, { exact: loc.exact });
      break;
    case "placeholder":
      l = page.getByPlaceholder(loc.value, { exact: loc.exact });
      break;
    case "css":
      l = page.locator(loc.value);
      break;
  }
  return loc.nth !== undefined ? l.nth(loc.nth) : l.first();
}

function describe(loc: Locator) {
  return loc.strategy === "role" && loc.name ? `role=${loc.value}[name="${loc.name}"]` : `${loc.strategy}=${loc.value}`;
}

async function runAction(
  page: Page,
  step: Step,
  def: ScenarioDefinition,
  random: () => number,
  signal: AbortSignal,
  hooks: EngineHooks,
  index: number,
  artifactIds: string[],
): Promise<Record<string, unknown> | void> {
  const timeout = step.timeoutMs;
  switch (step.type) {
    case "NAVIGATE": {
      const target = resolveStepUrl(step.url, def.startUrl);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new StepFailure("VALIDATION", `Unsupported URL scheme ${target.protocol}`);
      }
      const res = await page.goto(target.toString(), { waitUntil: step.waitUntil, timeout });
      const httpStatus = res?.status();
      if (httpStatus !== undefined && httpStatus >= 400) {
        throw new StepFailure("SITE_ERROR", `Navigation to ${target.pathname} returned HTTP ${httpStatus}`, { httpStatus });
      }
      return { url: target.toString(), httpStatus };
    }
    case "WAIT": {
      const ms =
        step.randomMaxMs !== undefined && step.randomMaxMs > step.durationMs
          ? Math.round(step.durationMs + random() * (step.randomMaxMs - step.durationMs))
          : step.durationMs;
      await abortableDelay(ms, signal);
      return { waitedMs: ms };
    }
    case "CLICK":
      await buildLocator(page, step.target).click({ timeout, button: step.button, clickCount: step.clickCount });
      return { target: describe(step.target) };
    case "HOVER":
      await buildLocator(page, step.target).hover({ timeout });
      return { target: describe(step.target) };
    case "SCROLL": {
      if (step.target) {
        await buildLocator(page, step.target).scrollIntoViewIfNeeded({ timeout });
        return { target: describe(step.target) };
      }
      const increments = step.steps;
      const per = step.deltaY / increments;
      for (let i = 0; i < increments; i++) {
        await page.mouse.wheel(0, per);
        if (increments > 1) await abortableDelay(100, signal);
      }
      return { deltaY: step.deltaY };
    }
    case "TYPE": {
      const l = buildLocator(page, step.target);
      if (step.clear) await l.fill("", { timeout });
      if (step.keyDelayMs > 0) await l.pressSequentially(step.text, { delay: step.keyDelayMs, timeout });
      else if (step.clear) await l.fill(step.text, { timeout });
      else await l.pressSequentially(step.text, { timeout });
      if (step.pressEnter) await l.press("Enter", { timeout });
      return { target: describe(step.target), length: step.text.length };
    }
    case "SELECT": {
      const l = buildLocator(page, step.target);
      // Try by value first, then by label.
      let selected = await l.selectOption({ value: step.option }, { timeout }).catch(() => [] as string[]);
      if (selected.length === 0) selected = await l.selectOption({ label: step.option }, { timeout });
      if (selected.length === 0) throw new StepFailure("SITE_ERROR", `Option "${step.option}" not found`);
      return { target: describe(step.target), selected };
    }
    case "ASSERT_VISIBLE": {
      const l = buildLocator(page, step.target);
      try {
        await l.waitFor({ state: step.negate ? "hidden" : "visible", timeout });
      } catch {
        throw new StepFailure(
          "ASSERTION",
          `Expected ${describe(step.target)} to be ${step.negate ? "hidden" : "visible"} within ${timeout}ms`,
          { expected: step.negate ? "hidden" : "visible" },
        );
      }
      return { target: describe(step.target), visible: !step.negate };
    }
    case "ASSERT_TEXT": {
      const l = buildLocator(page, step.target);
      const norm = (s: string) => (step.caseSensitive ? s : s.toLowerCase()).replace(/\s+/g, " ").trim();
      const expected = norm(step.expected);
      const deadline = Date.now() + timeout;
      let actual = "";
      let found = false;
      while (true) {
        try {
          actual = await l.innerText({ timeout: Math.max(100, Math.min(1000, deadline - Date.now())) });
          found = true;
        } catch {
          found = false;
        }
        const a = norm(actual);
        if (found && (step.match === "equals" ? a === expected : a.includes(expected))) {
          return { expected: step.expected, actual: actual.slice(0, 500), match: step.match };
        }
        if (Date.now() >= deadline) break;
        await abortableDelay(200, signal);
      }
      throw new StepFailure(
        "ASSERTION",
        found
          ? `Text of ${describe(step.target)} did not ${step.match === "equals" ? "equal" : "contain"} "${step.expected}"`
          : `Element ${describe(step.target)} was not found within ${timeout}ms`,
        { expected: step.expected, actual: found ? actual.slice(0, 500) : null, match: step.match },
      );
    }
    case "ASSERT_URL": {
      const deadline = Date.now() + timeout;
      const check = (u: string) => {
        if (step.match === "equals") return u === step.expected;
        if (step.match === "pathEquals") {
          try {
            return new URL(u).pathname === step.expected;
          } catch {
            return false;
          }
        }
        return u.includes(step.expected);
      };
      while (true) {
        const u = page.url();
        if (check(u)) return { expected: step.expected, actual: u, match: step.match };
        if (Date.now() >= deadline) {
          throw new StepFailure("ASSERTION", `URL ${u} did not match (${step.match}) "${step.expected}"`, {
            expected: step.expected,
            actual: u,
            match: step.match,
          });
        }
        await abortableDelay(100, signal);
      }
    }
    case "SCREENSHOT": {
      if (!hooks.captureScreenshot) return { captured: false };
      const id = await hooks.captureScreenshot(page, { stepIndex: index, fullPage: step.fullPage, reason: "step" });
      if (id) artifactIds.push(id);
      return { captured: Boolean(id) };
    }
  }
}

function currentUrl(page: Page): string | undefined {
  try {
    return page.isClosed() ? undefined : page.url();
  } catch {
    return undefined;
  }
}

function abortReason(signal: AbortSignal): "cancelled" | "timeout" {
  return signal.reason instanceof CancelledError ? signal.reason.reason : "cancelled";
}
function abortMessage(signal: AbortSignal): string {
  return signal.reason instanceof CancelledError ? signal.reason.message : "Run was cancelled";
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function safeHook(fn: () => unknown) {
  try {
    await fn();
  } catch {
    /* persistence hooks are best-effort here; the final result is saved by the worker */
  }
}
