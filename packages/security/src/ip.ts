import ipaddr from "ipaddr.js";

/**
 * Ranges that browser automation and server-side fetches must never reach
 * unless an administrator explicitly allowlists the host (local development).
 */
const BLOCKED_RANGES_V4 = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal", // 169.254.0.0/16 – includes cloud metadata 169.254.169.254
  "loopback",
  "private",
  "reserved",
  "carrierGradeNat",
]);
const BLOCKED_RANGES_V6 = new Set([
  "unspecified",
  "linkLocal",
  "multicast",
  "loopback",
  "uniqueLocal",
  "ipv4Mapped", // checked separately after unwrapping
  "rfc6145",
  "rfc6052",
  "6to4",
  "teredo",
  "reserved",
  "discard",
  "benchmarking",
  "orchid2",
]);

/** Explicit cloud metadata endpoints, blocked even when private hosts are allowlisted. */
export const METADATA_IPS = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254"]);
export const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
]);

export function isIp(value: string): boolean {
  return ipaddr.isValid(stripBrackets(value));
}

function stripBrackets(v: string) {
  return v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v;
}

/** True when the address is in a private, loopback, link-local or otherwise non-public range. */
export function isNonPublicIp(address: string): boolean {
  let addr = ipaddr.parse(stripBrackets(address));
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  const range = addr.range();
  return addr.kind() === "ipv4" ? BLOCKED_RANGES_V4.has(range) : BLOCKED_RANGES_V6.has(range);
}

export function isMetadataAddress(address: string): boolean {
  try {
    let addr = ipaddr.parse(stripBrackets(address));
    if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
    return METADATA_IPS.has(addr.toString());
  } catch {
    return false;
  }
}
