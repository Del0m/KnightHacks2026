-- Table the RAG ingest (CONN-08) writes and the planner (AI-12) reads.
-- DB-08 owns the real migration; this is the shape it should create. Safe to run by hand
-- on a dev branch until that migration exists.
--
-- DB-08 lists (source, content, metadata, embedding). The ingest also needs:
--   id            stable key per chunk, so re-runs upsert instead of duplicating
--   content_hash  so re-runs only re-embed chunks whose text changed

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id           text PRIMARY KEY,           -- e.g. "exercise:Barbell_Squat#0", "injury_note:knee#2"
  source       text NOT NULL,              -- "free-exercise-db" | "injury-notes"
  content      text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  embedding    vector(384) NOT NULL,       -- BAAI/bge-small-en-v1.5, normalised
  content_hash text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Cosine distance; bge embeddings are normalised, so this matches inner product.
CREATE INDEX IF NOT EXISTS doc_chunks_embedding_hnsw
  ON doc_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS doc_chunks_metadata_gin ON doc_chunks USING gin (metadata);
