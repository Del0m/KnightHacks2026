// BE-10: write side of the social layer. Every user-written post and comment passes moderation
// (CONN-09 behind the Moderator port) before it is saved. Auto-posts on medals and PRs are
// written by session finish (services/sessions.ts) only when the user opted in.
//
// A blocked post or comment is a 422 moderation_blocked. When it's self-harm, details.support is
// true: the app should show the message with support resources, not as an error. Other blocks
// are logged to moderation_blocks.
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, conflict, HttpError, notFound, parse, send, userId } from "../http.js";
import { BLOCKED_MESSAGE, type Moderator } from "../services/moderation.js";
import { isAbusiveComment } from "../services/commentSafety.js";
import { notBlocked } from "../services/blocks.js";
import { visiblePostsFilter } from "./feed.js";

const { posts, comments, kudos, follows, users, profiles, sessions, moderationBlocks } = schema;
const COMMENT_BLOCKED_MESSAGE = "SteadyForm is for lifting others up, not weighing them down.";

export const postInput = z
  .object({
    // Advice questions go through POST /advice (BE-11) once it exists.
    kind: z.enum(["session", "pr", "medal", "goal"]),
    body: z.string().trim().min(1).max(2000),
    title: z.string().trim().max(100).optional(),
    session_id: z.string().uuid().nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

export const commentInput = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

async function moderate(
  db: Db,
  moderator: Moderator,
  req: Request,
  text: string,
  target: { kind: "post" } | { kind: "comment"; postId: string },
): Promise<{ checked: boolean }> {
  const verdict =
    target.kind === "comment" && isAbusiveComment(text)
      ? {
          allowed: false as const,
          message: COMMENT_BLOCKED_MESSAGE,
          categories: ["local_abuse"],
        }
      : await moderator.check(text, target.kind);
  if (verdict.allowed) {
    if (target.kind === "comment" && verdict.checked === false) {
      throw new HttpError(
        503,
        "moderation_unavailable",
        "Comments cannot be checked right now. Your draft is saved; try again shortly.",
      );
    }
    return { checked: verdict.checked !== false };
  }
  if (verdict.support) {
    throw new HttpError(422, "moderation_blocked", verdict.message || BLOCKED_MESSAGE, { support: true });
  }
  // The user still gets their 422 if logging fails.
  try {
    await db.insert(moderationBlocks).values({
      authorId: userId(req),
      kind: target.kind,
      postId: target.kind === "comment" ? target.postId : null,
      body: text,
      categories: verdict.categories ?? [],
    });
  } catch (err) {
    req.log?.error({ err }, "couldn't log blocked content");
  }
  throw new HttpError(
    422,
    "moderation_blocked",
    target.kind === "comment" ? COMMENT_BLOCKED_MESSAGE : verdict.message || BLOCKED_MESSAGE,
  );
}

async function visiblePost(db: Db, me: string, postId: string) {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(eq(posts.id, postId), visiblePostsFilter(me, true)));
  if (!row) throw notFound("Post");
  return row;
}

export function socialRouter(db: Db, moderator: Moderator): Router {
  const router = Router();

  // The session row lock serializes retries; sharing this workout creates one session post.
  router.put("/sessions/:id/share", async (req, res) => {
    const me = userId(req),
      sessionId = parse(z.string().uuid(), req.params.id);
    const input = parse(postInput.pick({ body: true, data: true }), req.body);
    const { checked } = await moderate(db, moderator, req, input.body, { kind: "post" });
    const post = await db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, me)))
        .for("update")
        .limit(1);
      if (!session) throw notFound("Session");
      if (!session.finishedAt) throw conflict("This session is not finished");
      const [existing] = await tx
        .select()
        .from(posts)
        .where(and(eq(posts.authorId, me), eq(posts.sessionId, sessionId), eq(posts.kind, "session")))
        .limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(posts)
        .values({
          authorId: me,
          kind: "session",
          sessionId,
          body: input.body,
          data: input.data ?? null,
          moderationChecked: checked,
        })
        .returning();
      return created;
    });
    send(res, post);
  });

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
    const title =
      input.title ??
      (input.data?.title === undefined ? undefined : parse(z.string().trim().max(100), input.data.title));
    const { checked } = await moderate(db, moderator, req, [title, input.body].filter(Boolean).join("\n"), {
      kind: "post",
    });
    const [row] = await db
      .insert(posts)
      .values({
        authorId: me,
        kind: input.kind,
        body: input.body,
        sessionId: input.session_id ?? null,
        data: title !== undefined ? { ...input.data, title } : (input.data ?? null),
        moderationChecked: checked,
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
        author: { id: users.id, handle: users.handle, displayName: profiles.displayName },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .leftJoin(profiles, eq(profiles.userId, comments.authorId))
      .where(and(eq(comments.postId, postId), notBlocked(me, comments.authorId)))
      .orderBy(asc(comments.createdAt));
    const unsafeIds = rows.filter((row) => isAbusiveComment(row.body)).map((row) => row.id);
    if (unsafeIds.length)
      await db.delete(comments).where(and(eq(comments.postId, postId), inArray(comments.id, unsafeIds)));
    send(
      res,
      rows.filter((row) => !unsafeIds.includes(row.id)),
    );
  });

  router.post("/posts/:id/comments", async (req, res) => {
    const me = userId(req);
    const postId = parse(z.string().uuid(), req.params.id);
    const input = parse(commentInput, req.body);
    await visiblePost(db, me, postId);
    const { checked } = await moderate(db, moderator, req, input.body, { kind: "comment", postId });
    const [row] = await db
      .insert(comments)
      .values({ postId, authorId: me, body: input.body, moderationChecked: checked })
      .returning();
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
