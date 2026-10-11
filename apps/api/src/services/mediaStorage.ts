// Feed photos and videos in a private Cloudflare R2 bucket, through R2's S3-compatible API.
//
// The API never handles the file itself: it signs a short-lived PUT URL that the phone uploads to,
// checks the stored object (HEAD) when a post claims it, signs short-lived GET URLs for the feed,
// and deletes objects. Signing is local HMAC (aws4fetch), so a feed page costs no extra requests.
//
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. Without them uploads are
// switched off (POST /media/uploads answers 503) and everything else works as before.
import { AwsClient } from "aws4fetch";

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

/** What the media routes need from storage; tests use an in-memory fake. */
export interface MediaStorage {
  /** A URL the client PUTs the file to, with the headers it must send. */
  uploadUrl(
    key: string,
    contentType: string,
    expiresInS: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A URL anyone holding it can GET until it expires. */
  viewUrl(key: string, expiresInS: number): Promise<string>;
  /** The stored object's size and type, or null if nothing was uploaded. */
  head(key: string): Promise<StoredObject | null>;
  /** Best effort: missing keys are fine. */
  delete(keys: string[]): Promise<void>;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

type R2Env = Partial<
  Record<"R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET", string>
>;

export function r2ConfigFromEnv(env: R2Env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

export class R2Storage implements MediaStorage {
  private readonly aws: AwsClient;
  private readonly base: string;

  constructor(
    config: R2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    this.base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}/`;
  }

  private objectUrl(key: string): URL {
    return new URL(this.base + key.split("/").map(encodeURIComponent).join("/"));
  }

  private async presign(
    key: string,
    method: "GET" | "PUT",
    expiresInS: number,
    headers: Record<string, string>,
  ) {
    const url = this.objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(expiresInS));
    // allHeaders: sign Content-Type too, so an upload must declare the type it was approved for.
    const signed = await this.aws.sign(url.toString(), {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  }

  async uploadUrl(key: string, contentType: string, expiresInS: number) {
    // Lowercase: header names are case-insensitive, and the API's snake_case JSON would mangle "Content-Type".
    const headers = { "content-type": contentType };
    return { url: await this.presign(key, "PUT", expiresInS, headers), headers };
  }

  viewUrl(key: string, expiresInS: number) {
    return this.presign(key, "GET", expiresInS, {});
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await this.fetchImpl(await this.aws.sign(this.objectUrl(key).toString(), { method: "HEAD" }));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
    return {
      sizeBytes: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type"),
    };
  }

  async delete(keys: string[]) {
    await Promise.all(
      keys.map(async (key) => {
        const res = await this.fetchImpl(
          await this.aws.sign(this.objectUrl(key).toString(), { method: "DELETE" }),
        );
        if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
      }),
    );
  }
}
