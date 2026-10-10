// DB-08: vector store for the RAG planner (§10.1). Filled by `npm run rag:ingest` in rag/ (CONN-08),
// whose expected shape is rag/schema.sql: a stable text id per chunk so re-runs upsert, and a
// content hash so only changed chunks are re-embedded.
import { index, jsonb, pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "./users.js";

export const docChunks = pgTable(
  "doc_chunks",
  {
    id: text().primaryKey(), // e.g. "exercise:Barbell_Squat#0", "injury_note:knee#2"
    source: text().notNull(), // "free-exercise-db" | "injury-notes"
    content: text().notNull(),
    metadata: jsonb().notNull().default({}),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(), // normalised bge-small
    contentHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("doc_chunks_source_idx").on(t.source),
    index("doc_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("doc_chunks_metadata_gin").using("gin", t.metadata),
  ],
);
