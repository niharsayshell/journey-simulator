import { describe, expect, it } from "vitest";
import { verifyDomainOwnership, verificationInstructions } from "@js/security";

const base = { hostname: "shop.example.com", port: null, scheme: "https", token: "tok123" };
const policy = { privateHostAllowlist: [] };

describe("domain verification", () => {
  it("builds instructions", () => {
    const i = verificationInstructions({ ...base, method: "DNS_TXT" });
    expect(i.dns.name).toBe("_journey-simulator.shop.example.com");
    expect(i.dns.value).toBe("journey-simulator-verification=tok123");
    expect(i.file.url).toBe("https://shop.example.com/.well-known/journey-simulator-verification.txt");
  });
  it("verifies DNS TXT records (including split strings)", async () => {
    const ok = await verifyDomainOwnership({ ...base, method: "DNS_TXT" }, policy, {
      resolveTxt: async () => [["other"], ["journey-simulator-", "verification=tok123"]],
    });
    expect(ok.ok).toBe(true);
    const bad = await verifyDomainOwnership({ ...base, method: "DNS_TXT" }, policy, { resolveTxt: async () => [["nope"]] });
    expect(bad.ok).toBe(false);
  });
  it("verifies hosted files and rejects redirects / wrong content", async () => {
    const mk = (status: number, body: string) => async () => ({ status, body });
    expect((await verifyDomainOwnership({ ...base, method: "HTTP_FILE" }, policy, { fetchText: mk(200, "journey-simulator-verification=tok123\n") })).ok).toBe(true);
    expect((await verifyDomainOwnership({ ...base, method: "HTTP_FILE" }, policy, { fetchText: mk(302, "") })).detail).toMatch(/302/);
    expect((await verifyDomainOwnership({ ...base, method: "HTTP_FILE" }, policy, { fetchText: mk(200, "journey-simulator-verification=other") })).ok).toBe(false);
  });
  it("never fetches private addresses", async () => {
    const r = await verifyDomainOwnership({ hostname: "127.0.0.1", port: 9, scheme: "http", token: "t", method: "HTTP_FILE" }, policy);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/non-public/i);
  });
});
