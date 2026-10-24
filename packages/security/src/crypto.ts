import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

// ---- Secret encryption (AES-256-GCM) ----

export interface SecretBox {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/**
 * key: 32 bytes, base64 encoded (generate with `openssl rand -base64 32`).
 * Payload format: base64(iv[12] | tag[16] | ciphertext).
 */
export function createSecretBox(base64Key: string | undefined): SecretBox {
  if (!base64Key) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
    },
    decrypt(payload) {
      const buf = Buffer.from(payload, "base64");
      if (buf.length < 29) throw new Error("Invalid encrypted payload");
      const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

// ---- Password hashing (scrypt) ----

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- Tokens ----

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
