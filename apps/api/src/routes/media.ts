// Feed photos and videos, and member reports (services/feedMedia.ts).
//
//   POST   /media/uploads     { content_type, size_bytes, width?, height?, duration_ms? }
//                            -> 201 { id, kind, upload_url, method: "PUT", headers, expires_at }
//                            The app PUTs the file to upload_url with those headers, then sends
//                            the id in POST /posts { media_ids: [...] }.
//   DELETE /media/:id        drop an upload that hasn't been posted yet
//   POST   /posts/:id/report { reason, note? } -> { reported, already_reported, hidden }
import { and, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { notFound, parse, send, userId } from "../http.js";
import { notBlocked } from "../services/blocks.js";
import { createUpload, reportInput, reportPost, uploadInput, type MediaDeps } from "../services/feedMedia.js";

const { media, posts } = schema;

export function mediaRouter(db: Db, deps: MediaDeps): Router {
  const router = Router();

  router.post("/media/uploads", async (req, res) => {
    send(res, await createUpload(db, deps, userId(req), parse(uploadInput, req.body)), 201);
  });

  router.delete("/media/:id", async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [row] = await db
      .delete(media)
      .where(and(eq(media.id, id), eq(media.ownerId, userId(req)), isNull(media.postId)))
      .returning({ key: media.storageKey });
    if (!row) throw notFound("Upload");
    // Best effort: a leftover object has no row pointing at it, so nothing can show it.
    await deps.storage?.delete([row.key]).catch(() => {});
    res.status(204).end();
  });

  router.post("/posts/:id/report", async (req, res) => {
    const me = userId(req);
    const postId = parse(z.string().uuid(), req.params.id);
    const input = parse(reportInput, req.body);
    // Anything a member can see they can report; blocked users' posts aren't visible to them.
    const [visible] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), notBlocked(me, posts.authorId)));
    if (!visible) throw notFound("Post");
    send(res, await reportPost(db, me, postId, input));
  });

  return router;
}
