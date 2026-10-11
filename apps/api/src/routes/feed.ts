// BE-09: feed built on read (§12): own posts, followed users, and beginners at the same gym,
// newest first, with a keyset cursor on (created_at, id). Blocked users are hidden both ways, and
// a post hidden pending review (a reported video) is shown only to its author.
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, parse, send, userId } from "../http.js";
import { notBlocked } from "../services/blocks.js";
import { mediaForPosts, type MediaDeps } from "../services/feedMedia.js";

const { posts, users, profiles, follows, kudos, comments } = schema;

export const FEED_PAGE_SIZE = 20;

// Postgres keeps microseconds and JS Dates only milliseconds, so the cursor carries the
// timestamp as text from Postgres itself; otherwise posts in the same millisecond could be skipped.
interface Cursor {
  ts: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.ts}|${c.id}`).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const [ts, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const valid = ts && id && !Number.isNaN(Date.parse(ts)) && z.string().uuid().safeParse(id).success;
  if (!valid) throw badRequest("Invalid feed cursor");
  return { ts, id };
}

export function visiblePostsFilter(me: string, publicFeed = false) {
  const notHidden = or(isNull(posts.hiddenAt), eq(posts.authorId, me));
  // Public discovery reads shared posts only, never raw workout sessions.
  if (publicFeed) return and(notBlocked(me, posts.authorId), notHidden);
  const myGym = sql`(select ${profiles.gymPlaceId} from ${profiles} where ${profiles.userId} = ${me})`;
  return and(
    or(
      eq(posts.authorId, me),
      sql`${posts.authorId} in (select ${follows.followeeId} from ${follows} where ${follows.followerId} = ${me})`,
      and(eq(profiles.experienceLevel, "beginner"), sql`${profiles.gymPlaceId} = ${myGym}`),
    ),
    notBlocked(me, posts.authorId),
    notHidden,
  );
}

export function feedRouter(db: Db, mediaDeps: MediaDeps = { storage: null, checkImage: null }): Router {
  const router = Router();

  router.get("/feed", async (req, res) => {
    const me = userId(req);
    const { cursor, scope, type } = parse(
      z.object({
        cursor: z.string().max(200).optional(),
        scope: z.enum(["following", "public"]).default("following"),
        type: z.enum(["custom", "medal", "pr"]).optional(),
      }),
      req.query,
    );
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await db
      .select({
        id: posts.id,
        kind: posts.kind,
        body: posts.body,
        data: posts.data,
        sessionId: posts.sessionId,
        hiddenAt: posts.hiddenAt, // set only on the author's own post under review
        createdAt: posts.createdAt,
        cursorTs: sql<string>`to_char(${posts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        author: {
          id: users.id,
          handle: users.handle,
          displayName: profiles.displayName,
          experienceLevel: profiles.experienceLevel,
        },
        kudosCount: sql<number>`(select count(*)::int from ${kudos} where ${kudos.postId} = ${posts.id})`,
        commentCount: sql<number>`(select count(*)::int from ${comments} where ${comments.postId} = ${posts.id})`,
        viewerGaveKudos: sql<boolean>`exists (select 1 from ${kudos} where ${kudos.postId} = ${posts.id} and ${kudos.userId} = ${me})`,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(profiles, eq(profiles.userId, posts.authorId))
      .where(
        and(
          visiblePostsFilter(me, scope === "public"),
          type
            ? inArray(
                posts.kind,
                type === "custom" ? ["goal", "advice"] : type === "medal" ? ["session", "medal"] : ["pr"],
              )
            : undefined,
          after
            ? sql`(${posts.createdAt}, ${posts.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(FEED_PAGE_SIZE + 1);

    const page = rows.slice(0, FEED_PAGE_SIZE);
    const last = page.at(-1);
    const media = await mediaForPosts(
      db,
      mediaDeps,
      page.map((p) => p.id),
    );
    send(res, {
      posts: page.map(({ cursorTs: _c, ...p }) => ({ ...p, media: media.get(p.id) ?? [] })),
      nextCursor:
        rows.length > FEED_PAGE_SIZE && last ? encodeCursor({ ts: last.cursorTs, id: last.id }) : null,
    });
  });

  return router;
}
