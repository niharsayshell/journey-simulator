import type { ErrorCategory, StepType } from "@js/shared";

/** A failure with an explicit category, thrown by action handlers. */
export class StepFailure extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

const NETWORK_PATTERNS = [
  /net::ERR_/,
  /NS_ERROR_/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ECONNRESET/,
  /Could not connect/i,
  /SSL/i,
  /proxy/i,
];
const INFRA_PATTERNS = [/Target (page, context or browser )?(has been )?closed/i, /Browser has been closed/i, /browser has disconnected/i];

/** Map any thrown value to an error category and a user-readable message. */
export function classifyError(err: unknown, stepType: StepType): { category: ErrorCategory; message: string } {
  if (err instanceof StepFailure) return { category: err.category, message: err.message };
  const e = err as { name?: string; message?: string };
  const raw = (e?.message ?? String(err)).split("\n")[0]!.slice(0, 500);
  if (/net::ERR_BLOCKED_BY_CLIENT|NS_ERROR_FAILURE.*blocked|blocked by policy/i.test(raw)) {
    return { category: "SECURITY", message: `Request blocked by network policy: ${raw}` };
  }
  if (NETWORK_PATTERNS.some((p) => p.test(raw))) return { category: "NETWORK", message: raw };
  if (INFRA_PATTERNS.some((p) => p.test(raw))) return { category: "INFRASTRUCTURE", message: raw };
  if (e?.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(raw)) {
    return { category: stepType.startsWith("ASSERT_") ? "ASSERTION" : "TIMEOUT", message: raw };
  }
  if (stepType.startsWith("ASSERT_")) return { category: "ASSERTION", message: raw };
  return { category: "SITE_ERROR", message: raw };
}
