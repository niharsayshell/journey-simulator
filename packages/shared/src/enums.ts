export const RUN_STATUSES = ["QUEUED", "DISPATCHED", "RUNNING", "PASSED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["PASSED", "FAILED", "CANCELLED", "TIMED_OUT"];

export const BATCH_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLING", "CANCELLED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const STEP_STATUSES = ["PASSED", "FAILED", "SKIPPED", "CANCELLED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Error categories let reports separate "the platform broke" from
 * "the website broke" from "the website behaved differently than asserted".
 */
export const ERROR_CATEGORIES = [
  "INFRASTRUCTURE", // browser launch, worker crash, storage, queue
  "NETWORK", // DNS, proxy, connection refused, TLS
  "SITE_ERROR", // HTTP >= 400 on navigation, element never appeared
  "ASSERTION", // an ASSERT_* step evaluated false
  "TIMEOUT", // step or run deadline exceeded
  "SECURITY", // blocked by authorization / SSRF policy
  "CANCELLED",
  "VALIDATION", // invalid scenario / configuration
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;
export type BrowserEngine = (typeof BROWSER_ENGINES)[number];

export const PROXY_TYPES = ["HTTP", "HTTPS", "SOCKS5"] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export const SESSION_MODES = ["FRESH_SESSION", "RETURNING_SESSION", "AUTHENTICATED_TEST_ACCOUNT", "MULTI_ACCOUNT_TEST"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];
/** Session modes the worker can execute today. */
export const IMPLEMENTED_SESSION_MODES: readonly SessionMode[] = ["FRESH_SESSION"];

export const PROJECT_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const VERIFICATION_METHODS = ["DNS_TXT", "HTTP_FILE", "SELF_ATTESTED"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const DOMAIN_STATUSES = ["PENDING", "VERIFIED", "ATTESTED", "FAILED", "REVOKED"] as const;
/** Statuses that make a domain usable as an automation target. */
export const USABLE_DOMAIN_STATUSES = ["VERIFIED", "ATTESTED"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/**
 * Domain statuses accepted as targets. Self-declared (ATTESTED) domains can be
 * switched off by an administrator with ALLOW_SELF_ATTESTED_DOMAINS=false.
 */
export function usableDomainStatuses(env: Record<string, string | undefined>): DomainStatus[] {
  return env.ALLOW_SELF_ATTESTED_DOMAINS === "false" ? ["VERIFIED"] : ["VERIFIED", "ATTESTED"];
}
