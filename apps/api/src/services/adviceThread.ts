// BE-11: advice questions with an AI-suggested first answer (Architecture §10.2).
//
// AI-13's writer (services/advice.ts) decides what to say; this file does everything around it:
//   1. the question is saved as an "advice" post, with its bge-small query embedding
//   2. sources are retrieved with pgvector: the nearest injury-note sections and exercises in
//      doc_chunks, and community answers to similar advice questions the asker can see
//   3. the writer's result is stored as the first comment: the AI answer (ai_suggested, with the
//      sources it cites) or the fixed pain reply. Neither has an author: SteadyForum posts them.
// Moderation runs before any of this, in the route.
//
// Every step after the post is saved is best-effort: if embedding, retrieval or the model fails,
// the question still posts and community answers carry the thread.
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type { EmbedQuery } from "../integrations/huggingface/embed.js";
import { visiblePostsFilter } from "../routes/feed.js";
import type { AdviceAnswer, AdviceNoneReason, AdviceSource, AdviceWriter, LogLike } from "./advice.js";
import { notBlocked } from "./blocks.js";

const { posts, comments, profiles, docChunks } = schema;

export interface AdviceDeps {
  writer: Pick<AdviceWriter, "answer">;
  embed: EmbedQuery | null;
  log?: LogLike;
  answerTimeoutMs?: number; // both model calls share it (AI-13)
  embedTimeoutMs?: number;
}

const MAX_LIBRARY_SOURCES = 6;
const MAX_SIMILAR_QUESTIONS = 3;
const MIN_QUESTION_SIMILARITY = 0.75; // bge-small cosine; below this questions are about other things
const ANSWERS_PER_QUESTION = 2;

const silent: LogLike = { warn: () => {} };
const vectorLiteral = (v: number[]) => sql`${`[${v.join(",")}]`}::vector`;
const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** A doc_chunks row as a writer source, or null for chunks that can't be cited (team guidance). */
export function chunkSource(row: { id: string; content: string; metadata: unknown }): AdviceSource | null {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  if (m.kind === "injury_note") {
    // A team-guidance section has no page behind it, so it's never cited as a health body's advice.
    const urls = Array.isArray(m.sources)
      ? (m.sources as unknown[]).filter((u) => typeof u === "string")
      : [];
    if (m.team_guidance === true || !urls.length) return null;
    return {
      id: row.id,
      kind: "injury_note",
      title: `${String(m.title ?? "Injury note")}: ${String(m.section ?? "")}`.replace(/: $/, ""),
      content: row.content,
      url: urls[0] as string,
    };
  }
  if (m.kind === "exercise") {
    return {
      id: row.id,
      kind: "exercise",
      title: String(m.name ?? row.id),
      content: row.content,
      url: typeof m.source_url === "string" ? m.source_url : null,
    };
  }
  return null;
}

/** Sources for the writer, most similar first: library passages and community answers merged. */
export async function findSources(
  db: Db,
  me: string,
  postId: string,
  query: number[],
): Promise<AdviceSource[]> {
  const distance = sql`${docChunks.embedding} <=> ${vectorLiteral(query)}`;
  const library = await db
    .select({
      id: docChunks.id,
      content: docChunks.content,
      metadata: docChunks.metadata,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(docChunks)
    .where(sql`${docChunks.metadata}->>'kind' in ('injury_note', 'exercise')`)
    .orderBy(distance)
    .limit(MAX_LIBRARY_SOURCES * 2); // room for team-guidance sections, which are skipped

  const questionDistance = sql`${posts.embedding} <=> ${vectorLiteral(query)}`;
  const similar = await db
    .select({ id: posts.id, body: posts.body, similarity: sql<number>`1 - (${questionDistance})` })
    .from(posts)
    .leftJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        eq(posts.kind, "advice"),
        isNotNull(posts.embedding),
        ne(posts.id, postId),
        visiblePostsFilter(me), // only questions the asker could see in the feed
        sql`1 - (${questionDistance}) >= ${MIN_QUESTION_SIMILARITY}`,
      ),
    )
    .orderBy(questionDistance)
    .limit(MAX_SIMILAR_QUESTIONS);

  // Community answers only: members' comments, never an earlier AI answer, never a blocked user.
  const answers = similar.length
    ? await db
        .select({ id: comments.id, postId: comments.postId, body: comments.body })
        .from(comments)
        .where(
          and(
            inArray(
              comments.postId,
              similar.map((s) => s.id),
            ),
            isNotNull(comments.authorId),
            eq(comments.aiSuggested, false),
            notBlocked(me, comments.authorId),
          ),
        )
        .orderBy(asc(comments.createdAt))
    : [];

  const scored: { source: AdviceSource; score: number }[] = [];
  for (const row of library) {
    const source = chunkSource(row);
    if (source && scored.length < MAX_LIBRARY_SOURCES) scored.push({ source, score: Number(row.similarity) });
  }
  for (const q of similar) {
    for (const a of answers.filter((x) => x.postId === q.id).slice(0, ANSWERS_PER_QUESTION)) {
      scored.push({
        source: {
          id: a.id,
          kind: "community_answer",
          title: `Community answer to "${shorten(q.body, 60)}"`,
          content: a.body,
          post_id: q.id,
        },
        score: Number(q.similarity),
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.source);
}

export type AdviceOutcome =
  | { outcome: "ai"; reply: typeof comments.$inferSelect }
  | { outcome: "fixed_pain"; reply: typeof comments.$inferSelect }
  | { outcome: "none"; reason: AdviceNoneReason | "embedding_failed"; reply: null };

/** Saves the question and its first answer. Never throws after the post is saved. */
/** `moderationChecked` is false when moderation was unreachable (INT-04 re-checks the post later). */
export async function askAdvice(
  db: Db,
  deps: AdviceDeps,
  me: string,
  question: string,
  moderationChecked = true,
) {
  const log = deps.log ?? silent;
  let embedding: number[] | null = null;
  if (deps.embed) {
    try {
      embedding = await deps.embed(question, deps.embedTimeoutMs ?? 5_000);
    } catch (err) {
      log.warn(`[advice] question embedding failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const [post] = await db
    .insert(posts)
    .values({ authorId: me, kind: "advice", body: question, embedding, moderationChecked })
    .returning({
      id: posts.id,
      authorId: posts.authorId,
      kind: posts.kind,
      body: posts.body,
      createdAt: posts.createdAt,
    });

  let sources: AdviceSource[] = [];
  if (embedding) {
    try {
      sources = await findSources(db, me, post!.id, embedding);
    } catch (err) {
      log.warn(`[advice] retrieval failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The writer never throws; it checks pain before it looks at sources, so the fixed reply works
  // even when nothing could be retrieved.
  const answer: AdviceAnswer = await deps.writer.answer({ question, sources }, deps.answerTimeoutMs ?? 8_000);
  let result: AdviceOutcome;
  if (answer.kind === "none") {
    result = {
      outcome: "none",
      reason: !embedding && answer.reason === "no_sources" && deps.embed ? "embedding_failed" : answer.reason,
      reply: null,
    };
  } else {
    const [reply] = await db
      .insert(comments)
      .values({
        postId: post!.id,
        authorId: null, // posted by SteadyForum
        body: answer.text,
        aiSuggested: answer.kind === "ai",
        sources:
          answer.kind === "ai"
            ? answer.sources.map((s) => ({
                id: s.id,
                kind: s.kind,
                title: s.title,
                url: s.url ?? null,
                post_id: s.post_id ?? null,
              }))
            : null,
      })
      .returning();
    result = { outcome: answer.kind, reply: reply! };
  }
  return { post: post!, ...result };
}
