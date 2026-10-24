import { resolveTxt } from "node:dns/promises";
import { DNS_TXT_PREFIX, VERIFICATION_FILE_PATH, VERIFICATION_VALUE_PREFIX } from "@js/shared";
import { safeFetchText } from "./safe-fetch";
import type { NetworkPolicy } from "./url-policy";

export interface VerificationTarget {
  hostname: string;
  port: number | null;
  scheme: string;
  method: "DNS_TXT" | "HTTP_FILE";
  token: string;
}

export interface VerificationOutcome {
  ok: boolean;
  detail: string;
}

export function expectedVerificationValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}${token}`;
}

export function verificationInstructions(t: VerificationTarget) {
  const value = expectedVerificationValue(t.token);
  return {
    dns: { recordType: "TXT", name: `${DNS_TXT_PREFIX}.${t.hostname}`, value },
    file: { url: `${t.scheme}://${t.hostname}${t.port ? `:${t.port}` : ""}${VERIFICATION_FILE_PATH}`, contents: value },
  };
}

export async function verifyDomainOwnership(
  t: VerificationTarget,
  policy: NetworkPolicy,
  deps: { resolveTxt?: (name: string) => Promise<string[][]>; fetchText?: typeof safeFetchText } = {},
): Promise<VerificationOutcome> {
  const expected = expectedVerificationValue(t.token);
  const instr = verificationInstructions(t);
  if (t.method === "DNS_TXT") {
    try {
      const records = await (deps.resolveTxt ?? resolveTxt)(instr.dns.name);
      const values = records.map((r) => r.join(""));
      return values.some((v) => v.trim() === expected)
        ? { ok: true, detail: `TXT record found at ${instr.dns.name}` }
        : { ok: false, detail: `No matching TXT record at ${instr.dns.name} (found ${values.length} record(s))` };
    } catch (err) {
      return { ok: false, detail: `DNS lookup failed for ${instr.dns.name}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}` };
    }
  }
  try {
    const res = await (deps.fetchText ?? safeFetchText)(instr.file.url, policy, { timeoutMs: 5000, maxBytes: 1024 });
    if (res.status !== 200) return { ok: false, detail: `${instr.file.url} returned HTTP ${res.status} (redirects are not followed)` };
    return res.body.split(/\r?\n/).some((line) => line.trim() === expected)
      ? { ok: true, detail: `Verification file found at ${instr.file.url}` }
      : { ok: false, detail: `${instr.file.url} does not contain the expected value` };
  } catch (err) {
    return { ok: false, detail: `Could not fetch ${instr.file.url}: ${(err as Error).message}` };
  }
}
