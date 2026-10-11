// Feed photos and videos: upload URLs, attaching to posts, photo moderation, the feed's view URLs,
// reports that hide video posts, and clean-up. Storage is an in-memory fake; R2 signing is tested
// against the real signer without any network.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import type { ImageChecker } from "../src/integrations/huggingface/imageModeration.js";
import { cleanupPendingMedia, PENDING_TTL_MS } from "../src/services/feedMedia.js";
import {
  R2Storage,
  r2ConfigFromEnv,
  type MediaStorage,
  type StoredObject,
} from "../src/services/mediaStorage.js";
import { setup } from "./helpers.js";

class FakeStorage implements MediaStorage {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];
  async uploadUrl(key: string, contentType: string) {
    return { url: `https://r2.test/${key}?sig=put`, headers: { "content-type": contentType } };
  }
  async viewUrl(key: string, expiresInS: number) {
    return `https://r2.test/${key}?sig=get&exp=${expiresInS}`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(keys: string[]) {
    for (const k of keys) {
      this.objects.delete(k);
      this.deleted.push(k);
    }
  }
  /** What the phone does with the upload URL. */
  put(uploadUrl: string, sizeBytes: number, contentType: string) {
    this.objects.set(new URL(uploadUrl).pathname.slice(1), { sizeBytes, contentType });
  }
}

const PHOTO = { content_type: "image/jpeg", size_bytes: 200_000, width: 1080, height: 1350 };
const VIDEO = { content_type: "video/mp4", size_bytes: 5_000_000, duration_ms: 30_000 };

describe("feed photos and videos", () => {
  const storage = new FakeStorage();
  const checked: string[] = [];
  let verdict: Awaited<ReturnType<ImageChecker>> = { allowed: true, checked: true, categories: [] };
  let t: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    t = await setup({
      media: {
        storage,
        checkImage: async (url) => {
          checked.push(url);
          return verdict;
        },
      },
    });
  });
  afterAll(() => t.close());

  /** Requests an upload and performs it, as the phone would. */
  async function upload(user: string, body: object = PHOTO, uploaded = true) {
    const res = await (await t.as(user)).post("/media/uploads", body);
    expect(res.status).toBe(201);
    const b = body as { size_bytes: number; content_type: string };
    if (uploaded) storage.put(res.body.upload_url, b.size_bytes, b.content_type);
    return res.body as { id: string; upload_url: string; headers: Record<string, string> };
  }

  it("hands out a signed upload URL and rejects files it won't accept", async () => {
    const me = await t.as("m-up");
    const res = await me.post("/media/uploads", PHOTO);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "image",
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      upload_url: expect.stringMatching(/^https:\/\/r2\.test\/media\/[0-9a-f-]{36}\.jpg\?sig=put$/),
    });
    // No user id in the stored key.
    const [row] = await t.db.select().from(schema.media).where(eq(schema.media.id, res.body.id));
    expect(row).toMatchObject({ ownerId: "m-up", status: "pending", postId: null });
    expect(row!.storageKey).not.toContain("m-up");

    for (const bad of [
      { content_type: "image/gif", size_bytes: 10 },
      { content_type: "image/heic", size_bytes: 10 },
      { content_type: "image/jpeg", size_bytes: 11 * 1024 * 1024 },
      { content_type: "video/mp4", size_bytes: 1000 }, // no duration
      { content_type: "video/mp4", size_bytes: 1000, duration_ms: 61_000 },
      { content_type: "video/mp4", size_bytes: 51 * 1024 * 1024, duration_ms: 1000 },
    ]) {
      expect((await me.post("/media/uploads", bad)).status).toBe(400);
    }
  });

  it("posts photos in order, checks each one, and shows them in the feed with expiring URLs", async () => {
    const a = await upload("m-poster");
    const b = await upload("m-poster", { ...PHOTO, content_type: "image/png" });
    checked.length = 0;
    const res = await (
      await t.as("m-poster")
    ).post("/posts", {
      kind: "goal",
      body: "New gym, first session",
      media_ids: [b.id, a.id],
    });
    expect(res.status).toBe(201);
    expect(checked).toHaveLength(2); // both photos went through Llama Guard
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual([b.id, a.id]);
    expect(res.body).not.toHaveProperty("embedding");

    // A follower sees the post with its media and one-hour view URLs.
    const fan = await t.as("m-fan");
    await fan.post("/follows/m-poster");
    const feed = await fan.get("/feed");
    const post = feed.body.posts.find((p: { id: string }) => p.id === res.body.id);
    expect(post.media).toEqual([
      expect.objectContaining({
        id: b.id,
        kind: "image",
        content_type: "image/png",
        url: expect.stringMatching(/exp=3600$/),
      }),
      expect.objectContaining({ id: a.id, kind: "image", width: 1080, height: 1350 }),
    ]);
    // Posts without media still have an empty list.
    expect(feed.body.posts.every((p: { media: unknown[] }) => Array.isArray(p.media))).toBe(true);

    // The same upload can't be used twice.
    const again = await (
      await t.as("m-poster")
    ).post("/posts", { kind: "goal", body: "again", media_ids: [a.id] });
    expect(again.status).toBe(404);
  });

  it("refuses other people's uploads, unfinished uploads, mismatched files and bad mixes", async () => {
    const me = await t.as("m-mix");
    const mine = await upload("m-mix");
    const theirs = await upload("m-other");
    expect((await me.post("/posts", { kind: "goal", body: "x", media_ids: [theirs.id] })).status).toBe(404);

    const unfinished = await upload("m-mix", PHOTO, false);
    expect((await me.post("/posts", { kind: "goal", body: "x", media_ids: [unfinished.id] })).status).toBe(
      400,
    );

    // Uploaded something bigger than allowed: rejected, and the file is removed.
    const lied = await upload("m-mix", PHOTO, false);
    storage.put(lied.upload_url, 20 * 1024 * 1024, "image/jpeg");
    expect((await me.post("/posts", { kind: "goal", body: "x", media_ids: [lied.id] })).status).toBe(400);
    expect(await t.db.select().from(schema.media).where(eq(schema.media.id, lied.id))).toEqual([]);

    const video = await upload("m-mix", VIDEO);
    const video2 = await upload("m-mix", VIDEO);
    const photos = await Promise.all([1, 2, 3, 4].map(() => upload("m-mix")));
    expect(
      (await me.post("/posts", { kind: "goal", body: "x", media_ids: [mine.id, video.id] })).status,
    ).toBe(400);
    expect(
      (await me.post("/posts", { kind: "goal", body: "x", media_ids: [video.id, video2.id] })).status,
    ).toBe(400);
    expect(
      (await me.post("/posts", { kind: "goal", body: "x", media_ids: [mine.id, ...photos.map((p) => p.id)] }))
        .status,
    ).toBe(400); // 5 photos
    expect((await me.post("/posts", { kind: "goal", body: "x", media_ids: [mine.id, mine.id] })).status).toBe(
      400,
    );
    // Nothing was posted by any of those.
    expect(await t.db.select().from(schema.posts).where(eq(schema.posts.authorId, "m-mix"))).toEqual([]);
  });

  it("blocks a photo Llama Guard flags, and fails closed when it can't be reached", async () => {
    const me = await t.as("m-flagged");
    const bad = await upload("m-flagged");
    verdict = {
      allowed: false,
      checked: true,
      categories: ["S12"],
      message: "Please keep posts gym-friendly.",
    };
    const res = await me.post("/posts", { kind: "goal", body: "hello", media_ids: [bad.id] });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Please keep posts gym-friendly.");
    const [logged] = await t.db
      .select()
      .from(schema.moderationBlocks)
      .where(eq(schema.moderationBlocks.authorId, "m-flagged"));
    expect(logged).toMatchObject({ kind: "post", categories: ["S12"] });
    expect(storage.deleted).toContain(new URL(bad.upload_url).pathname.slice(1)); // the file is gone

    const later = await upload("m-flagged");
    verdict = { allowed: true, checked: false, categories: [] };
    const down = await me.post("/posts", { kind: "goal", body: "hello", media_ids: [later.id] });
    expect(down.status).toBe(503);
    expect(down.body.error).toBe("moderation_unavailable");
    expect(await t.db.select().from(schema.posts).where(eq(schema.posts.authorId, "m-flagged"))).toEqual([]);
    verdict = { allowed: true, checked: true, categories: [] };
  });

  it("posts a video without a photo check; a report hides it from everyone but its author", async () => {
    const video = await upload("m-video", VIDEO);
    checked.length = 0;
    const res = await (
      await t.as("m-video")
    ).post("/posts", { kind: "goal", body: "PR attempt", media_ids: [video.id] });
    expect(res.status).toBe(201);
    expect(checked).toEqual([]); // videos aren't sent to Llama Guard
    expect(res.body.media[0]).toMatchObject({ kind: "video", duration_ms: 30_000 });

    const viewer = await t.as("m-viewer");
    await viewer.post("/follows/m-video");
    expect((await viewer.get("/feed")).body.posts.map((p: { id: string }) => p.id)).toContain(res.body.id);

    const report = await viewer.post(`/posts/${res.body.id}/report`, { reason: "inappropriate" });
    expect(report.body).toEqual({ reported: true, already_reported: false, hidden: true });
    expect((await viewer.post(`/posts/${res.body.id}/report`, { reason: "spam" })).body).toMatchObject({
      already_reported: true,
    });
    expect((await viewer.get("/feed")).body.posts.map((p: { id: string }) => p.id)).not.toContain(
      res.body.id,
    );
    expect(
      (await viewer.get("/feed?scope=public")).body.posts.map((p: { id: string }) => p.id),
    ).not.toContain(res.body.id);
    expect((await viewer.get(`/posts/${res.body.id}/comments`)).status).toBe(404);
    // The author still sees it, marked as under review.
    const own = (await (await t.as("m-video")).get("/feed")).body.posts.find(
      (p: { id: string }) => p.id === res.body.id,
    );
    expect(own.hidden_at).not.toBeNull();
  });

  it("logs reports on photo and text posts without hiding them, and refuses odd reports", async () => {
    const photo = await upload("m-photo");
    const post = await (
      await t.as("m-photo")
    ).post("/posts", { kind: "goal", body: "view", media_ids: [photo.id] });
    const viewer = await t.as("m-reader");
    const res = await viewer.post(`/posts/${post.body.id}/report`, { reason: "spam", note: "ad" });
    expect(res.body).toEqual({ reported: true, already_reported: false, hidden: false });
    const [row] = await t.db
      .select()
      .from(schema.postReports)
      .where(eq(schema.postReports.postId, post.body.id));
    expect(row).toMatchObject({ reporterId: "m-reader", reason: "spam", note: "ad" });

    expect(
      (await (await t.as("m-photo")).post(`/posts/${post.body.id}/report`, { reason: "spam" })).status,
    ).toBe(400);
    expect((await viewer.post(`/posts/${post.body.id}/report`, { reason: "meh" })).status).toBe(400);
    expect(
      (await viewer.post("/posts/00000000-0000-4000-8000-000000000000/report", { reason: "spam" })).status,
    ).toBe(404);
  });

  it("lets the owner drop an unposted upload, cleans up abandoned ones, and deletes files with the account", async () => {
    const me = await t.as("m-tidy");
    const dropped = await upload("m-tidy");
    expect((await (await t.as("m-other")).delete(`/media/${dropped.id}`)).status).toBe(404);
    expect((await me.delete(`/media/${dropped.id}`)).status).toBe(204);
    expect(storage.objects.has(new URL(dropped.upload_url).pathname.slice(1))).toBe(false);

    const abandoned = await upload("m-tidy");
    expect(await cleanupPendingMedia(t.db, { storage, checkImage: null })).toBe(0); // too new
    expect(
      await cleanupPendingMedia(
        t.db,
        { storage, checkImage: null },
        new Date(Date.now() + PENDING_TTL_MS + 1000),
      ),
    ).toBeGreaterThan(0);
    expect(await t.db.select().from(schema.media).where(eq(schema.media.id, abandoned.id))).toEqual([]);

    const kept = await upload("m-tidy");
    await me.post("/posts", { kind: "goal", body: "bye", media_ids: [kept.id] });
    const key = new URL(kept.upload_url).pathname.slice(1);
    expect(storage.objects.has(key)).toBe(true);
    expect((await me.delete("/me")).status).toBe(204);
    expect(storage.objects.has(key)).toBe(false);
  });
});

describe("without R2", () => {
  it("switches uploads off and leaves posting and the feed as they were", async () => {
    const t = await setup();
    const me = await t.as("n-user");
    const res = await me.post("/media/uploads", PHOTO);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("media_unavailable");
    expect((await me.post("/posts", { kind: "goal", body: "text only" })).status).toBe(201);
    const withMedia = await me.post("/posts", {
      kind: "goal",
      body: "x",
      media_ids: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(withMedia.status).toBe(503);
    expect((await me.get("/feed")).body.posts[0].media).toEqual([]);
    await t.close();
  });
});

describe("R2 signing", () => {
  const config = r2ConfigFromEnv({
    R2_ACCOUNT_ID: "acct123",
    R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "steadyforum-media",
  })!;

  it("needs all four settings", () => {
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b" })).toBeNull();
  });

  it("signs upload and view URLs locally, with expiry and the content type bound to the upload", async () => {
    const r2 = new R2Storage(config, async () => {
      throw new Error("no network in this test");
    });
    const up = await r2.uploadUrl("media/abc.jpg", "image/jpeg", 900);
    const url = new URL(up.url);
    expect(url.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/steadyforum-media/media/abc.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(up.headers).toEqual({ "content-type": "image/jpeg" });
    const view = new URL(await r2.viewUrl("media/abc.jpg", 3600));
    expect(view.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(view.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/);
  });

  it("reads HEAD and treats a missing object as not uploaded", async () => {
    const seen: string[] = [];
    const r2 = new R2Storage(config, async (input) => {
      const req = input as Request;
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      if (req.url.includes("missing")) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: { "content-length": "1234", "content-type": "image/png" },
      });
    });
    expect(await r2.head("media/a.png")).toEqual({ sizeBytes: 1234, contentType: "image/png" });
    expect(await r2.head("media/missing.png")).toBeNull();
    await r2.delete(["media/a.png", "media/missing.png"]);
    expect(seen).toEqual([
      "HEAD /steadyforum-media/media/a.png",
      "HEAD /steadyforum-media/media/missing.png",
      "DELETE /steadyforum-media/media/a.png",
      "DELETE /steadyforum-media/media/missing.png",
    ]);
  });
});
