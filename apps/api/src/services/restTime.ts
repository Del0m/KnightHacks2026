// INT-05: the rest-time loop. After a set is saved, score it (CONN-05) and write its rest note
// (AI-11) inside a fixed budget, save both on the set, and return them in the same response.
//
// Budget (Architecture §5, §7), each enforced by a timeout:
//   save   <= 150 ms   (POST /sets inserting the set, reps and flags; logged, not cut off)
//   score  <= 1200 ms  (DatabricksScorer's own timeout, DATABRICKS_SCORE_TIMEOUT_MS)
//   note   <= 1000 ms  (the LLM's deadline)
//   total  <= 2500 ms  worst case; past it the phone score and the fixed note are returned
// Scoring and the note run in parallel: under INT-06 the note depends only on the rule flags,
// not on the score, so waiting for the score would only add latency.
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import {
  BEGINNER_BASELINE,
  phoneScore,
  type DatabricksScorer,
  type ScoreSetInput,
  type SetScore,
} from "../integrations/databricks/score.js";
import { BASELINE_WINDOW_DAYS, baselineShare } from "./medals.js";
import { fixedNote, type NoteInput, type RestNote, type RestNoteWriter, type SpecRule } from "./restNote.js";

export const REST_BUDGET_MS = { save: 150, score: 1200, note: 1000, total: 2500 } as const;

export interface RestTimeDeps {
  scorer?: Pick<DatabricksScorer, "scoreSet"> | null;
  notes: RestNoteWriter;
}

export interface RestRep {
  rangeDeg: number;
  tempoMs: number;
  quality?: number | null;
  flags: { ruleId: string }[];
}

export interface RestTimeResult {
  score: SetScore;
  rest_note: RestNote;
  timings_ms: { save: number; score: number; note: number; total: number };
}

function deadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback()), Math.max(0, ms));
    }),
  ]);
}

async function exerciseRules(db: Db, exerciseId: string): Promise<{ name: string; rules: SpecRule[] }> {
  const [row] = await db
    .select({ name: schema.exercises.name, spec: schema.exercises.formSpec })
    .from(schema.exercises)
    .where(eq(schema.exercises.id, exerciseId));
  const rules = (row?.spec as { rules?: SpecRule[] } | null)?.rules ?? [];
  return { name: row?.name ?? exerciseId, rules: Array.isArray(rules) ? rules : [] };
}

// The lifter's 4-week average form score (Architecture §8), as BE-05 uses for the workout medal.
async function userBaseline(db: Db, userId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - BASELINE_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ score: schema.sessions.formScore })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNotNull(schema.sessions.formScore),
        gte(schema.sessions.finishedAt, since),
        lt(schema.sessions.finishedAt, now),
      ),
    );
  return rows.length ? baselineShare(rows.map((r) => r.score!)) : BEGINNER_BASELINE;
}

/** Scores the saved set and writes its rest note within the budget, then stores both on the set. */
export async function restTimeResult(
  db: Db,
  deps: RestTimeDeps,
  args: {
    userId: string;
    setId: string;
    exerciseId: string;
    weightKg: number | null;
    reps: RestRep[];
    saveMs: number;
  },
): Promise<RestTimeResult> {
  const started = Date.now();
  const remaining = () => REST_BUDGET_MS.total - args.saveMs - (Date.now() - started);

  const [{ name, rules }, baseline] = await Promise.all([
    exerciseRules(db, args.exerciseId),
    userBaseline(db, args.userId, new Date()),
  ]);
  const scoreInput: ScoreSetInput = {
    exercise_id: args.exerciseId,
    weight_kg: args.weightKg,
    baseline_share: baseline,
    reps: args.reps.map((r) => ({
      range_deg: r.rangeDeg,
      tempo_ms: r.tempoMs,
      quality: r.quality ?? null,
      flags: r.flags.map((f) => ({ rule_id: f.ruleId })),
    })),
  };
  const noteInput: NoteInput = {
    exerciseName: name,
    rules,
    reps: args.reps.map((r) => ({ tempo_ms: r.tempoMs, flags: r.flags.map((f) => ({ rule_id: f.ruleId })) })),
  };

  const timed = async <T>(work: Promise<T>) => {
    const t = Date.now();
    const value = await work;
    return { value, ms: Date.now() - t };
  };
  const phone = (reason: string) => phoneScore(scoreInput, started, reason);
  const [score, note] = await Promise.all([
    timed(
      deadline(
        deps.scorer
          ? deps.scorer.scoreSet(scoreInput)
          : Promise.resolve(phone("Databricks scoring is not configured")),
        remaining(),
        () => phone("rest-time budget exceeded"),
      ),
    ),
    timed(
      deadline(deps.notes.write(noteInput, Math.min(REST_BUDGET_MS.note, remaining())), remaining(), () =>
        fixedNote(noteInput),
      ),
    ),
  ]);

  await db
    .update(schema.sets)
    .set({
      score: score.value,
      restNote: note.value,
      medal: score.value.medal,
      cleanShare: score.value.clean_share,
      scoreSource: score.value.source,
    })
    .where(eq(schema.sets.id, args.setId));

  return {
    score: score.value,
    rest_note: note.value,
    timings_ms: {
      save: args.saveMs,
      score: score.ms,
      note: note.ms,
      total: args.saveMs + (Date.now() - started),
    },
  };
}
