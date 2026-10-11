// DB-06: social graph behind the feed (§9.2 Social, §12). DB-09: buddy matches.
// Moderation log: posts and comments that moderation blocked.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS, users } from "./users.js";
import { sessions } from "./workouts.js";

export const postKind = pgEnum("post_kind", ["session", "pr", "medal", "goal", "advice"]);
export const buddyStatus = pgEnum("buddy_status", ["requested", "accepted", "declined"]);
export const moderatedKind = pgEnum("moderated_kind", ["post", "comment"]);

export const posts = pgTable(
  "posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: postKind().notNull(),
    body: text().notNull(),
    sessionId: uuid().references(() => sessions.id, { onDelete: "set null" }),
    data: jsonb(), // card payload: medal tier, PR value, goal progress
    // BE-11: advice questions only, the bge-small query embedding used to find similar questions.
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Keyset pagination: ORDER BY created_at DESC, id DESC.
    index("posts_created_idx").on(t.createdAt.desc(), t.id.desc()),
    index("posts_author_created_idx").on(t.authorId, t.createdAt.desc(), t.id.desc()),
    index("posts_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // Null for AI-suggested answers (BE-11).
    authorId: text().references(() => users.id, { onDelete: "cascade" }),
    body: text().notNull(),
    aiSuggested: boolean().notNull().default(false),
    // BE-11: what an AI-suggested answer cites, shown under it: [{ id, kind, title, url, post_id }].
    // A comment with no author is posted by Spotter itself (the AI answer or the fixed pain reply).
    sources: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_post_created_idx").on(t.postId, t.createdAt)],
);

// Posts and comments that moderation blocked, so repeat offenders show up (e.g. several S15
// threats aimed at one person's posts). Self-harm (S11) is never logged: it's someone in
// distress, not abuse, and the text is health data. Deleted with the author's account.
export const moderationBlocks = pgTable(
  "moderation_blocks",
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: moderatedKind().notNull(),
    // The post a blocked comment was aimed at; its author is who the comment targeted.
    postId: uuid().references(() => posts.id, { onDelete: "set null" }),
    body: text().notNull(),
    categories: text().array().notNull(), // e.g. ["S15"]
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_blocks_author_created_idx").on(t.authorId, t.createdAt.desc()),
    index("moderation_blocks_post_idx").on(t.postId),
  ],
);

export const kudos = pgTable(
  "kudos",
  {
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

// §12 safety: blocked users never appear in each other's feed or buddy suggestions.
export const blocks = pgTable(
  "blocks",
  {
    blockerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked_idx").on(t.blockedId)],
);

export const buddyMatches = pgTable(
  "buddy_matches",
  {
    id: uuid().primaryKey().defaultRandom(),
    aId: text() // requester
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bId: text() // recipient
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: real().notNull(),
    status: buddyStatus().notNull().default("requested"),
    reasons: jsonb().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per pair, whichever side asked first.
    uniqueIndex("buddy_matches_pair_uq").using(
      "btree",
      sql`least(${t.aId}, ${t.bId})`,
      sql`greatest(${t.aId}, ${t.bId})`,
    ),
    index("buddy_matches_b_idx").on(t.bId),
    check("buddy_matches_not_self", sql`${t.aId} <> ${t.bId}`),
  ],
);
