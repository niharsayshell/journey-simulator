import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Minimal object storage abstraction for screenshots and traces. */
export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,500}$/;
function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
}

export class LocalFsStorage implements StorageAdapter {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Key escapes storage root");
    return full;
  }
  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  async getStream(key: string) {
    const full = this.resolve(key);
    await stat(full);
    return createReadStream(full);
  }
  async read(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    opts: { region: string; endpoint?: string; forcePathStyle?: boolean; accessKeyId?: string; secretAccessKey?: string },
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async getStream(key: string) {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }
  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorageFromEnv(env: Record<string, string | undefined> = process.env): StorageAdapter {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    return new S3Storage(env.S3_BUCKET, {
      region: env.S3_REGION ?? "us-east-1",
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    });
  }
  return new LocalFsStorage(path.resolve(env.STORAGE_LOCAL_DIR ?? ".artifacts"));
}
