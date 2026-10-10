// BE-10: write side of the social layer. Every user-written post and comment passes moderation
// (CONN-09 behind the Moderator port) before it is saved. Auto-posts on medals and PRs are
// written by session finish (services/sessions.ts) only when the user opted in.
import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, HttpError, notFound, parse, send, userId } from "../http.js";
import { BLOCKED_MESSAGE, type Moderator } from "../services/moderation.js";
import { visiblePostsFilter } from "./feed.js";

const { posts, comments, kudos, follows, users, profiles, sessions } = schema;

export const postInput = z
  .object({
    // Advice questions go through POST /advice (BE-11) once it exists.
    kind: z.enum(["session", "pr", "medal", "goal"]),
    body: z.string().trim().min(1).max(2000),
    session_id: z.string().uuid().nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

export const commentInput = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

async function moderate(moderator: Moderator, text: string, kind: "post" | "comment") {
  const verdict = await moderator.check(text, kind);
  if (!verdict.allowed) {
    throw new HttpError(422, "moderation_blocked", verdict.message || BLOCKED_MESSAGE);
  }
}

async function visiblePost(db: Db, me: string, postId: string) {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(eq(posts.id, postId), visiblePostsFilter(me)));
  if (!row) throw notFound("Post");
  return row;
}

export function socialRouter(db: Db, moderator: Moderator): Router {
  const router = Router();

  router.post("/posts", async (req, res) => {
    const me = userId(req);
    const input = parse(postInput, req.body);
    if (input.session_id) {
      const [own] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, input.session_id), eq(sessions.userId, me)));
      if (!own) throw notFound("Session");
    }
    await moderate(moderator, input.body, "post");
    const [row] = await db
      .insert(posts)
      .values({
        authorId: me,
        kind: input.kind,
        body: input.body,
        sessionId: input.session_id ?? null,
        data: input.data ?? null,
      })
      .returning();
    send(res, row, 201);
  });

  router.get("/posts/:id/comments", async (req, res) => {
    const me = userId(req);
    const postId = parse(z.string().uuid(), req.params.id);
    await visiblePost(db, me, postId);
    const rows = await db
      .select({
        id: comments.id,
        body: comments.body,
        aiSuggested: comments.aiSuggested,
        createdAt: comments.createdAt,
        author: { id: users.id, handle: users.handle },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt));
    send(res, rows);
  });

  router.post("/posts/:id/comments", async (req, res) => {
    const me = userId(req);
    const postId = parse(z.string().uuid(), req.params.id);
    const input = parse(commentInput, req.body);
    await visiblePost(db, me, postId);
    await moderate(moderator, input.body, "comment");
    const [row] = await db.insert(comments).values({ postId, authorId: me, body: input.body }).returning();
    send(res, row, 201);
  });

  router.post("/posts/:id/kudos", async (req, res) => {
    const me = userId(req);
    const postId = parse(z.string().uuid(), req.params.id);
    await visiblePost(db, me, postId);
    await db.insert(kudos).values({ postId, userId: me }).onConflictDoNothing();
    res.status(204).end();
  });

  router.delete("/posts/:id/kudos", async (req, res) => {
    const postId = parse(z.string().uuid(), req.params.id);
    await db.delete(kudos).where(and(eq(kudos.postId, postId), eq(kudos.userId, userId(req))));
    res.status(204).end();
  });

  router.post("/follows/:userId", async (req, res) => {
    const me = userId(req);
    const target = parse(z.string().min(1).max(200), req.params.userId);
    if (target === me) throw badRequest("You can't follow yourself");
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, target));
    if (!exists) throw notFound("User");
    await db.insert(follows).values({ followerId: me, followeeId: target }).onConflictDoNothing();
    res.status(204).end();
  });

  router.delete("/follows/:userId", async (req, res) => {
    const target = parse(z.string().min(1).max(200), req.params.userId);
    await db.delete(follows).where(and(eq(follows.followerId, userId(req)), eq(follows.followeeId, target)));
    res.status(204).end();
  });

  return router;
}
