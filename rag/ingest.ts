// CONN-08: embed the exercise library and injury notes into Neon pgvector (Architecture §10.1).
//
//   cd rag && npm install && npm run rag:ingest            # reviewed notes only
//   npm run rag:ingest -- --include-drafts                  # also notes with reviewed: false
//
// Sources
//   free-exercise-db  876 exercises, public domain (Unlicense), pinned to one commit.
//                     One chunk per exercise. metadata.loads lists the joints it works, so the
//                     planner (AI-12) can filter by injury.
//   injury-notes      rag/notes/*.md, one chunk per "## " section. Each section's first line is
//                     "Sources: <url>, <url>" (the pages that support that section) or
//                     "Sources: team guidance" (team-written, never cited as a health body's
//                     advice). metadata.sources and metadata.team_guidance carry them per chunk.
//                     Notes are skipped until a teammate reviews them and sets reviewed: true.
//
// Re-runnable: chunk ids are stable and each row stores a hash of its text, so a re-run only
// embeds new or changed chunks, upserts them, and deletes chunks whose source is gone.
//
// Embeddings: BAAI/bge-small-en-v1.5 on HF Inference Providers (hf-inference), 384-d,
// normalised. Passages are embedded as-is; queries need QUERY_PREFIX (bge's retrieval
// instruction), so the planner must embed with the same model and prefix.
//
// Env (read from apps/api/.env): HF_TOKEN, DATABASE_URL. Table: see schema.sql (DB-08).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InferenceClient } from "@huggingface/inference";
import { neon } from "@neondatabase/serverless";

export const EMBED_MODEL = "BAAI/bge-small-en-v1.5";
export const EMBED_DIM = 384;
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const EXERCISE_DB_COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const EXERCISE_DB_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${EXERCISE_DB_COMMIT}/dist/exercises.json`;
const NOTES_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "notes");

const EMBED_BATCH = 32;
const WRITE_BATCH = 100;
const MAX_CHARS = 1800; // bge-small reads 512 tokens; longer text is cut off anyway

// ---- Chunks ----

export interface Chunk {
  id: string;
  source: "free-exercise-db" | "injury-notes";
  content: string;
  metadata: Record<string, unknown>;
}

interface Exercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
}

// Muscle -> joints it loads. Names match the injury notes' body_part and the risk model's.
const MUSCLE_LOADS: Record<string, string[]> = {
  quadriceps: ["knee"],
  hamstrings: ["knee", "hip"],
  calves: ["ankle"],
  glutes: ["hip"],
  adductors: ["hip"],
  abductors: ["hip"],
  "lower back": ["lower_back"],
  shoulders: ["shoulder"],
  chest: ["shoulder"],
  lats: ["shoulder"],
  traps: ["shoulder", "neck"],
  "middle back": ["shoulder"],
  biceps: ["elbow"],
  triceps: ["elbow"],
  forearms: ["wrist"],
  neck: ["neck"],
};

export function exerciseChunk(e: Exercise): Chunk {
  const loads = new Set<string>();
  for (const m of [...e.primaryMuscles, ...e.secondaryMuscles]) for (const j of MUSCLE_LOADS[m] ?? []) loads.add(j);
  if (e.category === "plyometrics") ["knee", "ankle"].forEach((j) => loads.add(j)); // landings

  const traits = [e.mechanic, e.force && `${e.force} movement`].filter(Boolean).join(", ");
  const content = [
    `${e.name}. A ${e.level} ${e.category} exercise${traits ? ` (${traits})` : ""} using ${e.equipment ?? "no equipment"}.`,
    `Primary muscles: ${e.primaryMuscles.join(", ") || "none listed"}.`,
    e.secondaryMuscles.length ? `Secondary muscles: ${e.secondaryMuscles.join(", ")}.` : "",
    `How to: ${e.instructions.join(" ")}`,
  ].filter(Boolean).join(" ").slice(0, MAX_CHARS);

  return {
    id: `exercise:${e.id}#0`,
    source: "free-exercise-db",
    content,
    metadata: {
      kind: "exercise",
      exercise_id: e.id,
      name: e.name,
      level: e.level,
      category: e.category,
      equipment: e.equipment,
      mechanic: e.mechanic,
      force: e.force,
      primary_muscles: e.primaryMuscles,
      secondary_muscles: e.secondaryMuscles,
      loads: [...loads].sort(),
      source_url: EXERCISE_DB_URL,
    },
  };
}

interface NoteSection {
  heading: string;
  text: string;
  sources: string[]; // the URLs that support this section; empty for team guidance
  team_guidance: boolean;
}

interface Note {
  file: string;
  body_part: string;
  title: string;
  reviewed: boolean;
  sections: NoteSection[];
}

// Front matter is minimal "key: value" lines. A note-level "sources" key from the old format is
// ignored: sources live on each section's "Sources:" line.
export function parseNote(file: string, raw: string): Note {
  raw = raw.replace(/\r\n/g, "\n"); // Windows checkouts (core.autocrlf)
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ["body_part", "title", "reviewed"]) if (!meta[key]) throw new Error(`${file}: missing ${key}`);

  const sections = m[2]
    .split(/^## /m)
    .slice(1) // text before the first heading is notes for the team, not content
    .map((s): NoteSection => {
      const [first, ...lines] = s.split("\n");
      const heading = first.trim();
      const body = lines.join("\n").trim();
      const src = body.match(/^Sources:[ \t]*(.*)/i); // the section's first line only
      if (!src) {
        throw new Error(`${file}: section "${heading}" must start with "Sources: <url>, ..." or "Sources: team guidance"`);
      }
      const list = src[1].trim();
      const team_guidance = list.toLowerCase() === "team guidance";
      const sources = team_guidance ? [] : list.split(",").map((u) => u.trim()).filter(Boolean);
      if (!team_guidance && !sources.length) throw new Error(`${file}: section "${heading}" has an empty Sources line`);
      const text = body.slice(src[0].length).replace(/\s+/g, " ").trim();
      return { heading, text, sources, team_guidance };
    })
    .filter((s) => s.text);

  return {
    file,
    body_part: meta.body_part,
    title: meta.title,
    reviewed: meta.reviewed === "true",
    sections,
  };
}

export function noteChunks(note: Note): Chunk[] {
  return note.sections.map((s, i) => ({
    id: `injury_note:${note.body_part}#${i}`,
    source: "injury-notes" as const,
    content: `${note.title}. ${s.heading}: ${s.text}`.slice(0, MAX_CHARS),
    metadata: {
      kind: "injury_note",
      body_part: note.body_part,
      title: note.title,
      section: s.heading,
      sources: s.sources,
      team_guidance: s.team_guidance,
      reviewed: note.reviewed,
      file: `rag/notes/${note.file}`,
    },
  }));
}

export async function loadChunks(opts: { includeDrafts: boolean }): Promise<{ chunks: Chunk[]; skippedDrafts: string[] }> {
  const res = await fetch(EXERCISE_DB_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`free-exercise-db HTTP ${res.status}`);
  const exercises = (await res.json()) as Exercise[];

  const skippedDrafts: string[] = [];
  const notes = readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseNote(f, readFileSync(join(NOTES_DIR, f), "utf8")))
    .filter((n) => {
      if (n.reviewed || opts.includeDrafts) return true;
      skippedDrafts.push(n.file);
      return false;
    });

  return { chunks: [...exercises.map(exerciseChunk), ...notes.flatMap(noteChunks)], skippedDrafts };
}

// ---- Embeddings ----

export type Embed = (texts: string[]) => Promise<number[][]>;

export function hfEmbedder(token: string): Embed {
  const client = new InferenceClient(token);
  return async (texts) => {
    for (let attempt = 1; ; attempt++) {
      try {
        // retry_on_error (default) also waits out hf-inference cold starts (503).
        const out = (await client.featureExtraction(
          { model: EMBED_MODEL, provider: "hf-inference", inputs: texts },
          { signal: AbortSignal.timeout(120_000) },
        )) as number[][];
        if (out.length !== texts.length || out.some((v) => v.length !== EMBED_DIM)) {
          throw new Error(`expected ${texts.length} x ${EMBED_DIM} embeddings`);
        }
        return out;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  };
}

// ---- Neon ----

// Matches neon(url).query(text, params) (returns rows) and PGlite/node-postgres ({ rows }).
export interface Db {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

async function rowsOf<T>(db: Db, text: string, params?: unknown[]): Promise<T[]> {
  const res = await db.query(text, params);
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

const hash = (text: string) => createHash("sha256").update(`${EMBED_MODEL}\n${text}`).digest("hex");

export interface IngestResult {
  total: number;
  embedded: number;
  unchanged: number;
  deleted: number;
  skippedDrafts: string[];
}

export async function ingest(db: Db, embed: Embed, chunks: Chunk[], skippedDrafts: string[] = []): Promise<IngestResult> {
  const tables = await rowsOf<{ ok: boolean }>(db, "SELECT to_regclass('doc_chunks') IS NOT NULL AS ok");
  if (!tables[0]?.ok) throw new Error("table doc_chunks is missing: run the DB-08 migration (or rag/schema.sql) first");

  const existing = new Map(
    (await rowsOf<{ id: string; content_hash: string }>(db, "SELECT id, content_hash FROM doc_chunks")).map((r) => [
      r.id,
      r.content_hash,
    ]),
  );
  const changed = chunks.filter((c) => existing.get(c.id) !== hash(c.content));

  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => c.content));
    for (let w = 0; w < batch.length; w += WRITE_BATCH) {
      const rows = batch.slice(w, w + WRITE_BATCH);
      const vecs = vectors.slice(w, w + WRITE_BATCH);
      await db.query(
        `INSERT INTO doc_chunks (id, source, content, metadata, embedding, content_hash, updated_at)
         SELECT id, source, content, metadata::jsonb, embedding::vector, content_hash, now()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
           AS t(id, source, content, metadata, embedding, content_hash)
         ON CONFLICT (id) DO UPDATE SET
           source = EXCLUDED.source, content = EXCLUDED.content, metadata = EXCLUDED.metadata,
           embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, updated_at = now()`,
        [
          rows.map((c) => c.id),
          rows.map((c) => c.source),
          rows.map((c) => c.content),
          rows.map((c) => JSON.stringify(c.metadata)),
          vecs.map((v) => `[${v.join(",")}]`),
          rows.map((c) => hash(c.content)),
        ],
      );
    }
    console.log(`[rag] embedded ${Math.min(i + EMBED_BATCH, changed.length)}/${changed.length}`);
  }

  // Chunks that no longer exist (exercise removed, note section deleted or back to draft).
  const keep = new Set(chunks.map((c) => c.id));
  const stale = [...existing.keys()].filter((id) => !keep.has(id));
  if (stale.length) await db.query("DELETE FROM doc_chunks WHERE id = ANY($1::text[])", [stale]);

  return { total: chunks.length, embedded: changed.length, unchanged: chunks.length - changed.length, deleted: stale.length, skippedDrafts };
}

// ---- CLI ----

async function main() {
  const missing = ["HF_TOKEN", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")} (add them to apps/api/.env)`);

  const { chunks, skippedDrafts } = await loadChunks({ includeDrafts: process.argv.includes("--include-drafts") });
  const sql = neon(process.env.DATABASE_URL!);
  const db: Db = { query: (text, params) => sql.query(text, params as unknown[]) };
  const r = await ingest(db, hfEmbedder(process.env.HF_TOKEN!), chunks, skippedDrafts);

  console.log(`[rag] ${r.total} chunks: ${r.embedded} embedded, ${r.unchanged} unchanged, ${r.deleted} deleted`);
  if (r.skippedDrafts.length) {
    console.log(`[rag] skipped draft notes (reviewed: false): ${r.skippedDrafts.join(", ")}. Use --include-drafts to ingest them.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[rag] ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
