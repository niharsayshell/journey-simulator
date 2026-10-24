import { describe, expect, it } from "vitest";
import { createSecretBox, hashPassword, randomToken, sha256, verifyPassword } from "@js/security";

const key = Buffer.alloc(32, 7).toString("base64");

describe("secret box", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const box = createSecretBox(key);
    const a = box.encrypt("hunter2");
    const b = box.encrypt("hunter2");
    expect(a).not.toBe(b);
    expect(a).not.toContain("hunter2");
    expect(box.decrypt(a)).toBe("hunter2");
  });
  it("detects tampering", () => {
    const box = createSecretBox(key);
    const buf = Buffer.from(box.encrypt("secret"), "base64");
    buf[buf.length - 1]! ^= 1;
    expect(() => box.decrypt(buf.toString("base64"))).toThrow();
  });
  it("rejects wrong keys and bad key sizes", () => {
    const enc = createSecretBox(key).encrypt("x");
    expect(() => createSecretBox(Buffer.alloc(32, 9).toString("base64")).decrypt(enc)).toThrow();
    expect(() => createSecretBox(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => createSecretBox(undefined)).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("passwords and tokens", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("creates unique tokens and stable hashes", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256("a")).toBe(sha256("a"));
  });
});
