import { describe, expect, it } from "vitest";
import {
  assertNavigationAllowed,
  assertPublicDestination,
  isNonPublicIp,
  matchesAuthorizedHost,
  parseTargetUrl,
  UrlPolicyError,
  type AuthorizedHost,
} from "@js/security";

const hosts: AuthorizedHost[] = [
  { hostname: "shop.example.com", port: null, allowSubdomains: false },
  { hostname: "example.org", port: null, allowSubdomains: true },
  { hostname: "localhost", port: 4100, allowSubdomains: false },
];
const noPrivate = { privateHostAllowlist: [] };
const resolveTo = (ip: string) => async () => [ip];

describe("IP classification", () => {
  it.each(["10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "%s is non-public",
    (ip) => expect(isNonPublicIp(ip)).toBe(true),
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("%s is public", (ip) => expect(isNonPublicIp(ip)).toBe(false));
});

describe("URL parsing", () => {
  it("rejects non-http schemes, credentials and metadata hosts", () => {
    expect(() => parseTargetUrl("file:///etc/passwd")).toThrow(UrlPolicyError);
    expect(() => parseTargetUrl("javascript:alert(1)")).toThrow(/Only http/);
    expect(() => parseTargetUrl("https://user:pw@shop.example.com/")).toThrow(/credentials/);
    expect(() => parseTargetUrl("http://169.254.169.254/latest/meta-data")).toThrow(/metadata/);
    expect(() => parseTargetUrl("http://metadata.google.internal/")).toThrow(/metadata/);
  });
});

describe("authorized host matching", () => {
  const m = (u: string) => matchesAuthorizedHost(new URL(u), hosts);
  it("matches exact hosts on default ports only", () => {
    expect(m("https://shop.example.com/a")).toBe(true);
    expect(m("http://shop.example.com/a")).toBe(true);
    expect(m("https://shop.example.com:8443/")).toBe(false);
    expect(m("https://evil.shop.example.com/")).toBe(false);
  });
  it("matches subdomains only when allowed", () => {
    expect(m("https://a.b.example.org/")).toBe(true);
    expect(m("https://example.org/")).toBe(true);
    expect(m("https://notexample.org/")).toBe(false);
    expect(m("https://example.org.evil.com/")).toBe(false);
  });
  it("requires the exact port when one is registered", () => {
    expect(m("http://localhost:4100/")).toBe(true);
    expect(m("http://localhost:4000/api")).toBe(false);
    expect(m("http://localhost/")).toBe(false);
  });
});

describe("destination checks (SSRF)", () => {
  it("blocks authorized hostnames that resolve to private addresses (DNS rebinding)", async () => {
    await expect(assertNavigationAllowed("https://shop.example.com/", hosts, noPrivate, resolveTo("10.1.2.3"))).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });
  it("blocks metadata addresses even for allowlisted hosts", async () => {
    await expect(
      assertPublicDestination(new URL("http://localhost:4100/"), { privateHostAllowlist: ["localhost:4100"] }, resolveTo("169.254.169.254")),
    ).rejects.toMatchObject({ code: "METADATA_ADDRESS" });
  });
  it("allows administrator-allowlisted private hosts", async () => {
    await expect(assertNavigationAllowed("http://localhost:4100/", hosts, { privateHostAllowlist: ["localhost:4100"] }, resolveTo("127.0.0.1"))).resolves.toBeInstanceOf(URL);
  });
  it("rejects unauthorized hosts before resolving", async () => {
    let called = false;
    await expect(
      assertNavigationAllowed("https://attacker.example.net/", hosts, noPrivate, async () => {
        called = true;
        return ["1.1.1.1"];
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_HOST" });
    expect(called).toBe(false);
  });
  it("allows public destinations", async () => {
    await expect(assertNavigationAllowed("https://shop.example.com/x", hosts, noPrivate, resolveTo("93.184.216.34"))).resolves.toBeInstanceOf(URL);
  });
  it("blocks literal private IPs", async () => {
    await expect(assertPublicDestination(new URL("http://192.168.0.10/"), noPrivate)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });
});
