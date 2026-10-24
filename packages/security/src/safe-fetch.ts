import { Agent, request } from "undici";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { isMetadataAddress, isNonPublicIp } from "./ip";
import { type NetworkPolicy, isPrivateAllowlisted, parseTargetUrl, UrlPolicyError } from "./url-policy";

/**
 * Server-side fetch hardened against SSRF and DNS rebinding: the address is
 * validated inside the socket's DNS lookup, so the IP that is checked is the
 * IP that is connected to. Redirects are never followed.
 */
export async function safeFetchText(
  rawUrl: string,
  policy: NetworkPolicy,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ status: number; body: string }> {
  const u = parseTargetUrl(rawUrl);
  const allowPrivate = isPrivateAllowlisted(u, policy);
  const check = (hostname: string, addr: string): Error | null => {
    if (isMetadataAddress(addr)) return new UrlPolicyError("Metadata address blocked", "METADATA_ADDRESS");
    if (!allowPrivate && isNonPublicIp(addr)) {
      return new UrlPolicyError(`${hostname} resolves to non-public address ${addr}`, "PRIVATE_ADDRESS");
    }
    return null;
  };
  // Node may call lookup with { all: true } (happy eyeballs); support both shapes.
  const lookup: LookupFunction = (hostname, options, cb) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return (cb as (e: Error) => void)(err);
      const list = addresses as unknown as Array<{ address: string; family: number }>;
      for (const a of list) {
        const bad = check(hostname, a.address);
        if (bad) return (cb as (e: Error) => void)(bad);
      }
      if ((options as { all?: boolean }).all) return (cb as (e: null, a: typeof list) => void)(null, list);
      const first = list[0];
      if (!first) return (cb as (e: Error) => void)(new UrlPolicyError(`No addresses for ${hostname}`, "DNS_FAILURE"));
      cb(null, first.address, first.family);
    });
  };
  // Literal IPs bypass lookup, so check them directly.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isMetadataAddress(host)) throw new UrlPolicyError("Metadata address blocked", "METADATA_ADDRESS");
    if (!allowPrivate && isNonPublicIp(host)) throw new UrlPolicyError(`Non-public address ${host}`, "PRIVATE_ADDRESS");
  }
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxBytes = opts.maxBytes ?? 4096;
  const dispatcher = new Agent({ connect: { lookup, timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  try {
    const res = await request(u, {
      method: "GET",
      dispatcher,
      headers: { "user-agent": "JourneySimulator-Verifier/1.0", accept: "text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.body.destroy();
        break;
      }
      chunks.push(chunk as Buffer);
    }
    return { status: res.statusCode, body: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes) };
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}
