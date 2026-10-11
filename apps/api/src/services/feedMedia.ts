// Photos and videos on feed posts.
//
//   1. POST /media/uploads   the phone declares the file; the API saves a pending row and returns
//                            a signed URL the file is PUT to (straight to R2, never through here)
//   2. POST /posts           with media_ids: each upload is checked against what was declared,
//                            photos go through Llama Guard, then the post claims them
//   3. GET /feed             each post carries its media with view URLs that expire in an hour
//
// A post has 1-4 photos or exactly 1 video. Photos are checked before the post is saved and
// fail closed when moderation can't be reached. Videos can't be checked automatically: a member
// report hides a post with a video until a teammate reviews it.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, conflict, HttpError, notFound, userId } from "../http.js";
import type { ImageChecker } from "../integrations/huggingface/imageModeration.js";
import { BLOCKED_MESSAGE } from "./moderation.js";
import type { MediaStorage } from "./mediaStorage.js";

const { media, posts, postReports, moderationBlocks } = schema;

export interface MediaDeps {
  storage: MediaStorage | null; // null: R2 isn't configured, uploads are off
  checkImage: ImageChecker | null; // null: no HF_TOKEN (local dev), photos aren't checked
  log?: { warn(msg: string): void };
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_MS = 60_000;
export const MAX_IMAGES = 4;
export const UPLOAD_URL_SECONDS = 15 * 60;
export const VIEW_URL_SECONDS = 60 * 60;
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // unclaimed uploads are deleted after this

const UNAVAILABLE = () =>
  new HttpError(503, "media_unavailable", "Photo and video uploads aren't set up on this server yet.");

export const uploadInput = z
  .object({
    content_type: z.string().max(60),
    size_bytes: z.number().int().positive(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    duration_ms: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const image = v.content_type in IMAGE_TYPES;
    const video = v.content_type in VIDEO_TYPES;
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (!image && !video) issue("Use a JPEG, PNG or WebP photo, or an MP4 or MOV video", "content_type");
    if (image && v.size_bytes > MAX_IMAGE_BYTES) issue("Photos can be up to 10 MB", "size_bytes");
    if (video && v.size_bytes > MAX_VIDEO_BYTES) issue("Videos can be up to 50 MB", "size_bytes");
    if (video && v.duration_ms === undefined) issue("Say how long the video is", "duration_ms");
    if (video && (v.duration_ms ?? 0) > MAX_VIDEO_MS) issue("Videos can be up to 60 seconds", "duration_ms");
  });

export async function createUpload(db: Db, deps: MediaDeps, me: string, input: z.infer<typeof uploadInput>) {
  if (!deps.storage) throw UNAVAILABLE();
  const kind = input.content_type in IMAGE_TYPES ? "image" : "video";
  const ext = (IMAGE_TYPES[input.content_type] ?? VIDEO_TYPES[input.content_type])!;
  const storageKey = `media/${randomUUID()}.${ext}`; // no user id in the key
  const [row] = await db
    .insert(media)
    .values({
      ownerId: me,
      kind,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: kind === "video" ? (input.duration_ms ?? null) : null,
      storageKey,
    })
    .returning({ id: media.id, kind: media.kind });
  const upload = await deps.storage.uploadUrl(storageKey, input.content_type, UPLOAD_URL_SECONDS);
  return {
    id: row!.id,
    kind: row!.kind,
    uploadUrl: upload.url,
    method: "PUT",
    headers: upload.headers,
    expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000),
  };
}

type MediaRow = typeof media.$inferSelect;

async function discard(db: Db, deps: MediaDeps, rows: MediaRow[]) {
  if (!rows.length) return;
  await db.delete(media).where(
    inArray(
      media.id,
      rows.map((r) => r.id),
    ),
  );
  await deps.storage?.delete(rows.map((r) => r.storageKey)).catch((err: unknown) => {
    deps.log?.warn(`[media] couldn't delete objects: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Checks the uploads a new post wants: the caller's own, unclaimed, uploaded as declared, a valid
 * mix, and photos past moderation. Throws the error to show; returns the rows in the given order.
 */
export async function prepareMedia(
  db: Db,
  deps: MediaDeps,
  req: Request,
  ids: string[],
): Promise<MediaRow[]> {
  if (!ids.length) return [];
  if (!deps.storage) throw UNAVAILABLE();
  if (new Set(ids).size !== ids.length) throw badRequest("The same photo or video is listed twice");
  const me = userId(req);
  const found = await db
    .select()
    .from(media)
    .where(
      and(inArray(media.id, ids), eq(media.ownerId, me), isNull(media.postId), eq(media.status, "pending")),
    );
  if (found.length !== ids.length) throw notFound("Upload");
  const rows = ids.map((id) => found.find((r) => r.id === id)!);

  const videos = rows.filter((r) => r.kind === "video").length;
  if (videos > 1 || (videos === 1 && rows.length > 1)) {
    throw badRequest("A post can have one video, or up to 4 photos, not both");
  }
  if (rows.length > MAX_IMAGES) throw badRequest("A post can have up to 4 photos");

  // The upload must be there, and match what was approved.
  for (const row of rows) {
    const stored = await deps.storage.head(row.storageKey);
    if (!stored) throw badRequest("A photo or video hasn't finished uploading yet");
    const limit = row.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    const wrongType = stored.contentType !== null && stored.contentType !== row.contentType;
    if (stored.sizeBytes <= 0 || stored.sizeBytes > limit || wrongType) {
      await discard(db, deps, [row]);
      throw badRequest("A photo or video didn't upload as described. Try adding it again.");
    }
  }

  // Photos are checked before the post is saved. Videos rely on reports.
  if (deps.checkImage) {
    for (const row of rows.filter((r) => r.kind === "image")) {
      const verdict = await deps.checkImage(await deps.storage.viewUrl(row.storageKey, 10 * 60));
      if (verdict.allowed && verdict.checked === false) {
        throw new HttpError(
          503,
          "moderation_unavailable",
          "Photos can't be checked right now. Try posting again in a moment.",
        );
      }
      if (!verdict.allowed) {
        await discard(
          db,
          deps,
          rows.filter((r) => r.id === row.id),
        );
        if (verdict.support) {
          throw new HttpError(422, "moderation_blocked", verdict.message || BLOCKED_MESSAGE, {
            support: true,
          });
        }
        try {
          await db.insert(moderationBlocks).values({
            authorId: me,
            kind: "post",
            body: `[photo ${row.id}]`,
            categories: verdict.categories ?? [],
          });
        } catch (err) {
          req.log?.error({ err }, "couldn't log blocked photo");
        }
        throw new HttpError(422, "moderation_blocked", verdict.message || BLOCKED_MESSAGE);
      }
    }
  }
  return rows;
}

/** Claims the checked uploads for a post. Run in the post's transaction. */
export async function attachMedia(tx: Db, postId: string, rows: MediaRow[]) {
  for (const [position, row] of rows.entries()) {
    const claimed = await tx
      .update(media)
      .set({ postId, position, status: "attached", attachedAt: new Date() })
      .where(and(eq(media.id, row.id), isNull(media.postId)))
      .returning({ id: media.id });
    if (!claimed.length) throw conflict("A photo or video was already used in another post");
  }
}

export interface MediaView {
  id: string;
  kind: "image" | "video";
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Media for each post, in order, with view URLs that expire in an hour. */
export async function mediaForPosts(
  db: Db,
  deps: MediaDeps,
  postIds: string[],
): Promise<Map<string, MediaView[]>> {
  const out = new Map<string, MediaView[]>();
  if (!postIds.length) return out;
  const rows = await db
    .select()
    .from(media)
    .where(and(inArray(media.postId, postIds), eq(media.status, "attached")))
    .orderBy(asc(media.postId), asc(media.position));
  for (const row of rows) {
    if (!deps.storage) break; // no storage configured: posts show without their media
    const list = out.get(row.postId!) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      url: await deps.storage.viewUrl(row.storageKey, VIEW_URL_SECONDS),
      contentType: row.contentType,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
    });
    out.set(row.postId!, list);
  }
  return out;
}

export const reportInput = z
  .object({
    reason: z.enum(["spam", "harassment", "inappropriate", "unsafe", "other"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** A member reports a post. A post with a video is hidden from everyone but its author until reviewed. */
export async function reportPost(db: Db, me: string, postId: string, input: z.infer<typeof reportInput>) {
  const [post] = await db
    .select({ authorId: posts.authorId, hiddenAt: posts.hiddenAt })
    .from(posts)
    .where(eq(posts.id, postId));
  if (!post) throw notFound("Post");
  const [video] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.postId, postId), eq(media.kind, "video")))
    .limit(1);
  if (post.authorId === me) throw badRequest("You can't report your own post");
  const inserted = await db
    .insert(postReports)
    .values({ postId, reporterId: me, reason: input.reason, note: input.note ?? null })
    .onConflictDoNothing()
    .returning({ id: postReports.id });
  let hidden = post.hiddenAt !== null;
  if (video && !hidden) {
    await db.update(posts).set({ hiddenAt: new Date() }).where(eq(posts.id, postId));
    hidden = true;
  }
  return { reported: true, alreadyReported: inserted.length === 0, hidden };
}

/** Storage keys of everything a user uploaded, read before their account is deleted. */
export async function mediaKeysOf(db: Db, ownerId: string): Promise<string[]> {
  const rows = await db.select({ key: media.storageKey }).from(media).where(eq(media.ownerId, ownerId));
  return rows.map((r) => r.key);
}

/** Deletes uploads nobody claimed within PENDING_TTL_MS. Returns how many were removed. */
export async function cleanupPendingMedia(db: Db, deps: MediaDeps, now = new Date()): Promise<number> {
  const stale = await db
    .select()
    .from(media)
    .where(and(eq(media.status, "pending"), lt(media.createdAt, new Date(now.getTime() - PENDING_TTL_MS))))
    .limit(200);
  await discard(db, deps, stale);
  return stale.length;
}
