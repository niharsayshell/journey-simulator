import { lookup } from "node:dns/promises";
import { isIp, isMetadataAddress, isNonPublicIp, METADATA_HOSTNAMES } from "./ip";

export class UrlPolicyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "UNSUPPORTED_SCHEME"
      | "CREDENTIALS_IN_URL"
      | "UNAUTHORIZED_HOST"
      | "PRIVATE_ADDRESS"
      | "METADATA_ADDRESS"
      | "DNS_FAILURE"
      | "BLOCKED_PORT",
  ) {
    super(message);
    this.name = "UrlPolicyError";
  }
}

/** An authorized origin, derived from a VERIFIED domain record. */
export interface AuthorizedHost {
  hostname: string;
  /** null → only the scheme default port (80/443) */
  port: number | null;
  allowSubdomains: boolean;
}

export interface NetworkPolicy {
  /**
   * Hosts (hostname or hostname:port) an administrator allows to resolve to
   * private addresses – e.g. "localhost:4100" for the bundled demo site.
   * Never configurable by end users.
   */
  privateHostAllowlist: string[];
}

export function parsePrivateHostAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function effectivePort(u: URL): number {
  if (u.port) return Number(u.port);
  return u.protocol === "https:" ? 443 : 80;
}

/** Syntactic checks that do not need DNS. */
export function parseTargetUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UrlPolicyError(`Invalid URL: ${truncate(raw)}`, "INVALID_URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlPolicyError(`Only http and https URLs are allowed (got ${u.protocol})`, "UNSUPPORTED_SCHEME");
  }
  if (u.username || u.password) throw new UrlPolicyError("URLs must not contain credentials", "CREDENTIALS_IN_URL");
  const host = u.hostname.toLowerCase();
  if (METADATA_HOSTNAMES.has(host) || isMetadataAddress(host)) {
    throw new UrlPolicyError("Cloud metadata endpoints are never allowed", "METADATA_ADDRESS");
  }
  return u;
}

/** True when the URL's host and port fall under one of the authorized hosts. */
export function matchesAuthorizedHost(u: URL, hosts: AuthorizedHost[]): boolean {
  const hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  const port = effectivePort(u);
  return hosts.some((h) => {
    const base = h.hostname.toLowerCase();
    const hostOk = hostname === base || (h.allowSubdomains && hostname.endsWith(`.${base}`));
    if (!hostOk) return false;
    if (h.port === null) return u.port === "" || port === 80 || port === 443;
    return port === h.port;
  });
}

export function isPrivateAllowlisted(u: URL, policy: NetworkPolicy): boolean {
  const hostname = u.hostname.toLowerCase();
  const withPort = `${hostname}:${effectivePort(u)}`;
  return policy.privateHostAllowlist.includes(withPort) || policy.privateHostAllowlist.includes(hostname);
}

export type Resolver = (hostname: string) => Promise<string[]>;
export const systemResolver: Resolver = async (hostname) => {
  const res = await lookup(hostname, { all: true, verbatim: true });
  return res.map((r) => r.address);
};

/**
 * Resolve the host and make sure every address is public, unless the host is
 * administrator-allowlisted. Returns the resolved addresses.
 */
export async function assertPublicDestination(
  u: URL,
  policy: NetworkPolicy,
  resolver: Resolver = systemResolver,
): Promise<string[]> {
  const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIp(hostname)) addresses = [hostname];
  else {
    try {
      addresses = await resolver(hostname);
    } catch (err) {
      throw new UrlPolicyError(`DNS lookup failed for ${hostname}: ${(err as Error).message}`, "DNS_FAILURE");
    }
  }
  if (addresses.length === 0) throw new UrlPolicyError(`No addresses for ${hostname}`, "DNS_FAILURE");
  for (const a of addresses) {
    if (isMetadataAddress(a)) throw new UrlPolicyError("Cloud metadata endpoints are never allowed", "METADATA_ADDRESS");
  }
  if (isPrivateAllowlisted(u, policy)) return addresses;
  const bad = addresses.find((a) => isNonPublicIp(a));
  if (bad) {
    throw new UrlPolicyError(`${hostname} resolves to a non-public address (${bad}); private networks are blocked`, "PRIVATE_ADDRESS");
  }
  return addresses;
}

/** Full check used before any navigation: syntax, authorization, then DNS. */
export async function assertNavigationAllowed(
  raw: string,
  hosts: AuthorizedHost[],
  policy: NetworkPolicy,
  resolver?: Resolver,
): Promise<URL> {
  const u = parseTargetUrl(raw);
  if (!matchesAuthorizedHost(u, hosts)) {
    throw new UrlPolicyError(`${u.host} is not an authorized domain for this project`, "UNAUTHORIZED_HOST");
  }
  await assertPublicDestination(u, policy, resolver);
  return u;
}

function truncate(s: string, n = 120) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
