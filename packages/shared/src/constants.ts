/** Name of the file served under /.well-known/ for HTTP_FILE verification. */
export const VERIFICATION_FILE_PATH = "/.well-known/journey-simulator-verification.txt";
/** DNS TXT records are looked up at `${DNS_TXT_PREFIX}.${hostname}`. */
export const DNS_TXT_PREFIX = "_journey-simulator";
/** Value prefix used in both the DNS record and the hosted file. */
export const VERIFICATION_VALUE_PREFIX = "journey-simulator-verification=";

export const QUEUE_NAMES = {
  runs: "journey-runs",
  proxyTests: "journey-proxy-tests",
} as const;

export const REDIS_CHANNELS = {
  events: "journey:events",
  cancel: "journey:cancel",
} as const;

export const DEFAULT_TEST_HEADER_NAME = "X-Journey-Simulator";
