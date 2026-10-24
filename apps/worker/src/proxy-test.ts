import { prisma, type PrismaClient } from "@js/database";
import { testProxyThroughBrowser, type ProxyConfig } from "@js/browser-engine";
import { assertPublicDestination, createSecretBox, type NetworkPolicy } from "@js/security";
import type { ProxyTestResult } from "@js/shared";

/** Test a proxy profile through a real browser and record the observed egress. */
export async function runProxyTest(
  proxyProfileId: string,
  deps: { db?: PrismaClient; encryptionKey: string; checkUrl: string; policy: NetworkPolicy },
): Promise<ProxyTestResult> {
  const db = deps.db ?? prisma;
  const p = await db.proxyProfile.findUniqueOrThrow({ where: { id: proxyProfileId }, include: { credentialSecret: true } });
  const base = { checkedUrl: deps.checkUrl, engine: "chromium" as const, proxyType: p.type, testedAt: new Date().toISOString() };
  let result: ProxyTestResult;
  try {
    await assertPublicDestination(new URL(`http://${p.host}:${p.port}`), deps.policy);
    const proxy: ProxyConfig = { type: p.type, host: p.host, port: p.port };
    if (p.credentialSecret) Object.assign(proxy, JSON.parse(createSecretBox(deps.encryptionKey).decrypt(p.credentialSecret.ciphertext)));
    const r = await testProxyThroughBrowser({ proxy, checkUrl: deps.checkUrl, timeoutMs: 20_000 });
    result = { ...base, ...r };
  } catch (err) {
    result = { ...base, ok: false, error: (err as Error).message, errorCategory: "SECURITY" };
  }
  // Never let credentials leak through error messages.
  if (result.error) result.error = result.error.replace(/\/\/[^@/\s]+@/g, "//***@").slice(0, 500);
  await db.proxyProfile.update({
    where: { id: proxyProfileId },
    data: {
      lastTestAt: new Date(result.testedAt),
      lastTestOk: result.ok,
      lastEgressIp: result.egressIp ?? null,
      lastLatencyMs: result.latencyMs ?? null,
      lastTestError: result.error ?? null,
    },
  });
  return result;
}
