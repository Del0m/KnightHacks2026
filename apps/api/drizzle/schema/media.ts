// Feed photos and videos, and member reports on posts.
//
// Files live in a private Cloudflare R2 bucket (services/mediaStorage.ts); Neon keeps only the
// metadata and the object key. A row starts `pending` when the phone asks for an upload URL and
// becomes `attached` when a post claims it. Deleting the post or the account deletes the rows;
// the files are removed by the API at the same time (and by the cleanup job for abandoned uploads).
//
// These are photos and videos a member chooses to post. Workout camera frames still never leave
// the phone (Architecture §13).
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { posts } from "./social.js";
import { users } from "./users.js";

export const mediaKind = pgEnum("media_kind", ["image", "video"]);
export const mediaStatus = pgEnum("media_status", ["pending", "attached"]);

export const media = pgTable(
  "media",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid().references(() => posts.id, { onDelete: "cascade" }),
    position: integer(), // order within the post
    kind: mediaKind().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(), // declared at upload, checked against the stored object on attach
    width: integer(),
    height: integer(),
    durationMs: integer(), // videos
    storageKey: text().notNull().unique(), // "media/<uuid>.<ext>": no user id in the key
    status: mediaStatus().notNull().default("pending"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attachedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("media_post_idx").on(t.postId, t.position),
    index("media_pending_idx").on(t.status, t.createdAt),
    check("media_size_positive", sql`${t.sizeBytes} > 0`),
  ],
);

// One report per member per post. A report on a post with a video hides the post pending review
// (posts.hidden_at), because videos can't be checked automatically; other reports are logged.
export const postReports = pgTable(
  "post_reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    reporterId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("post_reports_post_reporter_uq").on(t.postId, t.reporterId),
    index("post_reports_post_idx").on(t.postId),
  ],
);
