// AI-12: the RAG planner (Architecture §10.1). The AI drafts the plan; plain code checks that it's safe.
//
//   1. Who: level, goals, injuries, training days (FE-03 schedule) and the last six weeks of training
//      (planHistory.ts), plus likes and dislikes (preferences.ts).
//   2. Find: the five camera-tracked exercises (specs/exercises) and the nearest library exercises
//      in doc_chunks (free-exercise-db, CONN-08), searched with a query built from goals and level
//      and nudged towards the user's taste vector. Exercises that load an injured joint are
//      filtered out in the query and again in code. A tracked exercise whose spec has an
//      injury_override for that joint stays, adapted, unless the injury is severe.
//   3. Draft: gpt-oss writes the week as JSON (CONN-07). Without HF_TOKEN, or if it fails or is
//      slow, the rule-based draft below is used instead (source "rules").
//   4. Check, in code, whichever draft it is: only safe candidates, 3-5 exercises a day,
//      suggested sets and reps as the ceiling, weekly reps at most 10% over the last trained
//      week, compound and machine work first for beginners, disliked exercises swapped for a
//      similar one when there is one, and physio notes. Every item keeps the chunks it came from.
//
// While a rehab plan is active (DB-12) the physio's plan is the plan, so no gym plan is made.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { checkNote, loadBanned } from "../../../../specs/validate.mjs";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { HttpError } from "../http.js";
import type { EmbedQuery } from "../integrations/huggingface/embed.js";
import type { HfLlm, JsonSchema } from "../integrations/huggingface/llm.js";
import {
  addDays,
  daysBetween,
  historySummary,
  loadHistory,
  mondayOf,
  type ExerciseHistory,
  type History,
} from "./planHistory.js";
import { ADVICE_DISCLAIMER } from "./advice.js";
import { loadRatings, normalize, preferences, rebuildTaste, type Preference } from "./preferences.js";
import { activePlan } from "./rehab.js";
import type { LogLike } from "./restNote.js";

const { exercises, plans, planItems, profiles, injuries, docChunks, exercisePreferences } = schema;

export type Level = "beginner" | "intermediate" | "advanced";
export type Pattern = "lower" | "push" | "pull" | "core";
export type Severity = "mild" | "moderate" | "severe";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// What the planner needs to know about the camera-tracked exercises, which the specs don't say.
// `loads` uses the injury body parts; `twin` is the free-exercise-db entry for the same movement,
// whose chunk stands in for it in vector search and the taste vector. A new spec needs an entry here.
export const TRACKED: Record<
  string,
  { pattern: Pattern; loads: string[]; compound: boolean; machine: boolean; angle: string; twin: string }
> = {
  squat: {
    pattern: "lower",
    loads: ["hip", "knee", "lower_back"],
    compound: true,
    machine: false,
    angle: "knee",
    twin: "Bodyweight_Squat",
  },
  lunge: {
    pattern: "lower",
    loads: ["ankle", "hip", "knee"],
    compound: true,
    machine: false,
    angle: "knee",
    twin: "Dumbbell_Lunges",
  },
  push_up: {
    pattern: "push",
    loads: ["elbow", "shoulder", "wrist"],
    compound: true,
    machine: false,
    angle: "elbow",
    twin: "Pushups",
  },
  shoulder_press: {
    pattern: "push",
    loads: ["elbow", "lower_back", "shoulder"],
    compound: true,
    machine: false,
    angle: "elbow",
    twin: "Standing_Dumbbell_Press",
  },
  bicep_curl: {
    pattern: "pull",
    loads: ["elbow", "wrist"],
    compound: false,
    machine: false,
    angle: "elbow",
    twin: "Dumbbell_Bicep_Curl",
  },
};

const MUSCLE_PATTERN: Record<string, Pattern> = {
  quadriceps: "lower",
  hamstrings: "lower",
  glutes: "lower",
  calves: "lower",
  adductors: "lower",
  abductors: "lower",
  chest: "push",
  shoulders: "push",
  triceps: "push",
  lats: "pull",
  "middle back": "pull",
  biceps: "pull",
  traps: "pull",
  forearms: "pull",
  abdominals: "core",
  "lower back": "core",
};

// free-exercise-db levels a user of each level may get.
const LIBRARY_LEVELS: Record<Level, string[]> = {
  beginner: ["beginner"],
  intermediate: ["beginner", "intermediate"],
  advanced: ["beginner", "intermediate", "expert"],
};

const START: Record<Level, { sets: number; reps: number }> = {
  beginner: { sets: 3, reps: 10 },
  intermediate: { sets: 3, reps: 10 },
  advanced: { sets: 4, reps: 8 },
};
const REP_RANGE: Record<Level, [number, number]> = {
  beginner: [6, 12],
  intermediate: [5, 15],
  advanced: [4, 15],
};
const MAX_SETS: Record<Level, number> = { beginner: 3, intermediate: 4, advanced: 5 };
const PER_DAY: Record<Level, number> = { beginner: 3, intermediate: 4, advanced: 5 };
export const MIN_PER_DAY = 3;
export const MAX_PER_DAY = 5;
const MIN_REPS = 5; // the volume cap trims reps down to this before it removes sets
const LIBRARY_POOL = 40;
const MAX_LLM_CANDIDATES = 24;
const MAX_REASON_CHARS = 140;

const FULL_BODY: Pattern[] = ["lower", "push", "pull", "core", "lower"];
const UPPER: Pattern[] = ["push", "pull", "push", "pull", "core"];
const LOWER: Pattern[] = ["lower", "lower", "core", "lower", "core"];

const banned = loadBanned();

export interface Injury {
  bodyPart: string;
  severity: Severity;
}

export interface Candidate {
  id: string;
  name: string;
  tracked: boolean;
  pattern: Pattern;
  compound: boolean;
  machine: boolean;
  equipment: string | null;
  level: Level;
  muscles: string[];
  loads: string[];
  chunkId: string | null; // its own chunk, or its twin's for a tracked exercise
  similarity: number | null; // to the search query
  tasteSimilarity: number | null; // to the user's taste vector
  preference: Preference | null;
  adaptedFor: { bodyPart: string; note: string }[]; // tracked, with the spec's injury override
  score: number;
  baseScore: number; // the score without likes and dislikes, to explain swaps
}

export interface DraftItem {
  day: number;
  exerciseId: string;
  sets: number;
  reps: number;
  reason: string | null;
  swapNote: string | null;
  safetyNote: string | null;
  sources: string[];
  carried?: boolean; // copied from the plan this one replaces (a day already past)
}

export interface PlannerDeps {
  llm: Pick<HfLlm, "generateJson"> | null;
  embed: EmbedQuery | null;
  log?: LogLike;
  llmTimeoutMs?: number;
  embedTimeoutMs?: number;
  now?: () => Date; // tests pin the date; defaults to the clock
}

const silent: LogLike = { warn: () => {} };
const titleCase = (s: string) => s.replace(/_/g, " ");

// ---- Schedule ----

type TrainingSchedule =
  { kind: "weekly"; days: number[] } | { kind: "interval"; every_days: number; start_date: string } | null;

const SLOT_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Plan days (0 = Monday) the user trains in the week of `weekOf`. */
export function trainingDays(schedule: TrainingSchedule, slots: string[], weekOf: string): number[] {
  let days: number[];
  if (schedule?.kind === "weekly") {
    days = schedule.days.map((d) => (d + 6) % 7); // FE-03 days are 0 = Sunday, like Date.getDay()
  } else if (schedule?.kind === "interval") {
    days = [0, 1, 2, 3, 4, 5, 6].filter((i) => {
      const since = daysBetween(schedule.start_date, addDays(weekOf, i));
      return since >= 0 && since % schedule.every_days === 0;
    });
  } else {
    days = slots.map((s) => SLOT_DAYS.indexOf(s.split("_")[0]!)).filter((d) => d >= 0);
    if (!days.length) days = [0, 2, 4];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

// ---- Safety ----

type SpecOverrides = Record<string, { extra_note?: string } | undefined>;

/**
 * Whether an exercise is safe for these injuries. A library exercise that loads an injured joint
 * is out. A tracked one stays if its spec adapts it for that joint (shorter range, slower tempo),
 * unless the injury is severe. "other" injuries have no body part, so nothing can be filtered.
 */
export function safety(
  loads: string[],
  overrides: SpecOverrides | null,
  injuryList: Injury[],
): { ok: true; adaptedFor: { bodyPart: string; note: string }[] } | { ok: false; bodyPart: string } {
  const adaptedFor: { bodyPart: string; note: string }[] = [];
  for (const injury of injuryList) {
    if (!loads.includes(injury.bodyPart)) continue;
    const override = overrides?.[injury.bodyPart];
    if (!override || injury.severity === "severe") return { ok: false, bodyPart: injury.bodyPart };
    adaptedFor.push({
      bodyPart: injury.bodyPart,
      note: override.extra_note ?? "Any pain is worth raising with your physio or a doctor.",
    });
  }
  return { ok: true, adaptedFor };
}

// ---- Ranking ----

/** Higher is better. Likes and taste only re-rank: unsafe exercises never get this far. */
export function rankScore(
  c: Omit<Candidate, "score" | "baseScore">,
  level: Level,
  withPreference = true,
): number {
  const similarity = c.similarity ?? 0.5;
  let score = 0.4 * similarity + (c.tracked ? 0.15 : 0);
  if (level === "beginner" && (c.compound || c.machine)) score += 0.1;
  if (withPreference) {
    const direct = c.preference?.score ?? 0;
    score += 0.3 * direct;
    // Taste stands in for exercises the user has no history or rating with.
    if (!direct && c.tasteSimilarity !== null) score += 0.15 * c.tasteSimilarity;
  }
  return score;
}

// ---- Sets and reps ----

export interface Prescription {
  sets: number;
  reps: number;
  reason: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Sets and reps from the exercise's recent history; the ceiling for the LLM's draft too. */
export function prescribe(
  c: Pick<Candidate, "tracked" | "id">,
  h: ExerciseHistory | undefined,
  ctx: { level: Level; goals: string[]; adherence: number | null; rom: History["rom"] },
): Prescription {
  const [lo, hi] = REP_RANGE[ctx.level];
  const maxSets = MAX_SETS[ctx.level];
  if (!h?.sessions || h.setsPerSession === null || h.repsPerSet === null) {
    const start = { ...START[ctx.level] };
    if (ctx.goals.includes("strength") && ctx.level !== "beginner")
      Object.assign(start, { sets: 4, reps: 6 });
    else if (ctx.goals.includes("endurance")) start.reps = Math.min(hi, 15);
    return { ...start, reason: `New this week, starting at ${start.sets} × ${start.reps}.` };
  }

  let sets = Math.min(maxSets, Math.max(1, Math.round(h.setsPerSession)));
  let reps = Math.min(hi, Math.max(lo, Math.round(h.repsPerSet)));
  const recent = h.cleanRecent ?? h.clean;
  const declining = h.cleanRecent !== null && h.cleanBefore !== null && h.cleanRecent < h.cleanBefore - 0.15;
  const angle = c.tracked ? TRACKED[c.id]?.angle : undefined;
  const romDrop = angle ? ctx.rom.find((r) => r.angle === angle && r.changeDeg <= -5) : undefined;

  if (romDrop) {
    reps = Math.max(lo, reps - 2);
    return {
      sets,
      reps,
      reason: `A little lighter: ${romDrop.side} ${romDrop.angle} range dipped ${Math.round(-romDrop.changeDeg)}° recently.`,
    };
  }
  if ((recent !== null && recent < 0.5) || declining) {
    reps = Math.max(lo, reps - 2);
    const why = declining ? "clean reps have dipped lately" : `${pct(recent!)} of recent reps were clean`;
    return { sets, reps, reason: `Fewer reps while form settles: ${why}.` };
  }
  const earned = h.medals.gold + h.medals.silver > 0 || h.prs > 0 || (recent ?? 0) >= 0.9;
  if (recent !== null && recent >= 0.8 && (ctx.adherence === null || ctx.adherence >= 0.75) && earned) {
    const before = `${sets} × ${reps}`;
    if (reps + 2 <= hi) reps += 2;
    else if (sets < maxSets) sets += 1;
    else
      return {
        sets,
        reps,
        reason: `Holding at the top of the range: ${pct(recent)} of recent reps were clean.`,
      };
    const pr = h.prs ? `, with ${h.prs === 1 ? "a PR" : `${h.prs} PRs`} in six weeks` : "";
    return { sets, reps, reason: `Up from ${before}: ${pct(recent)} of recent reps were clean${pr}.` };
  }
  return { sets, reps, reason: `Same as recent sessions, ${sets} × ${reps}.` };
}

// ---- Volume cap ----

/** Trims the new items until the week fits `cap` reps. Returns whether anything was trimmed. */
export function capVolume(items: DraftItem[], cap: number | null): boolean {
  if (cap === null) return false;
  const volume = () => items.reduce((s, i) => s + i.sets * i.reps, 0);
  let trimmed = false;
  while (volume() > cap) {
    const editable = items.filter((i) => !i.carried);
    if (!editable.length) break;
    const biggest = editable.reduce((a, b) => (b.sets * b.reps > a.sets * a.reps ? b : a));
    trimmed = true;
    if (biggest.reps > MIN_REPS) biggest.reps -= 1;
    else if (biggest.sets > 1) biggest.sets -= 1;
    else items.splice(items.indexOf(biggest), 1); // safety first: the cap wins over 3 a day
  }
  return trimmed;
}

// ---- Retrieval ----

interface ChunkHit {
  id: string;
  metadata: Record<string, unknown>;
  similarity: number | null;
  tasteSimilarity: number | null;
}

const vectorLiteral = (v: number[]) => sql`${`[${v.join(",")}]`}::vector`;

async function searchChunks(
  db: Db,
  opts: {
    query: number[] | null;
    taste: number[] | null;
    ids?: string[];
    levels?: string[];
    avoid?: string[];
    limit?: number;
  },
): Promise<ChunkHit[]> {
  const similarity = opts.query
    ? sql<number>`1 - (${docChunks.embedding} <=> ${vectorLiteral(opts.query)})`
    : sql<null>`null::float`;
  const tasteSimilarity = opts.taste
    ? sql<number>`1 - (${docChunks.embedding} <=> ${vectorLiteral(opts.taste)})`
    : sql<null>`null::float`;
  const meta = (key: string) => sql`${docChunks.metadata}->>${key}`;
  const where = opts.ids
    ? inArray(docChunks.id, opts.ids)
    : and(
        sql`${meta("kind")} = 'exercise'`,
        sql`${meta("category")} = 'strength'`,
        inArray(meta("level"), opts.levels ?? []),
        // Injury filter in the search itself: nothing that loads an injured joint comes back.
        opts.avoid?.length
          ? sql`not (${docChunks.metadata}->'loads' ?| array[${sql.join(
              opts.avoid.map((a) => sql`${a}`),
              sql`, `,
            )}]::text[])`
          : undefined,
      );
  const nearest = opts.query ?? opts.taste;
  const rows = await db
    .select({ id: docChunks.id, metadata: docChunks.metadata, similarity, tasteSimilarity })
    .from(docChunks)
    .where(where)
    .orderBy(
      nearest
        ? sql`${docChunks.embedding} <=> ${vectorLiteral(nearest)}`
        : sql`(${meta("mechanic")} = 'compound') desc, ${docChunks.id}`,
    )
    .limit(opts.limit ?? 1000);
  return rows.map((r) => ({
    id: r.id,
    metadata: r.metadata as Record<string, unknown>,
    similarity: r.similarity === null ? null : Number(r.similarity),
    tasteSimilarity: r.tasteSimilarity === null ? null : Number(r.tasteSimilarity),
  }));
}

export function searchText(level: Level, goals: string[], injuryList: Injury[]): string {
  const parts = injuryList.map((i) => i.bodyPart).filter((p) => p !== "other");
  const text = `${level} strength exercises for ${goals.length ? goals.join(", ") : "general fitness"}`;
  return parts.length
    ? `${text}, easy on a recovering ${[...new Set(parts)].map(titleCase).join(" and ")}`
    : text;
}

const libraryLevel = (level: unknown): Level =>
  level === "expert" ? "advanced" : level === "intermediate" ? "intermediate" : "beginner";

function libraryCandidate(
  hit: ChunkHit,
): Omit<Candidate, "score" | "baseScore" | "preference" | "adaptedFor"> | null {
  const m = hit.metadata;
  const muscles = (m.primary_muscles as string[] | undefined) ?? [];
  const pattern = muscles.map((x) => MUSCLE_PATTERN[x]).find(Boolean);
  if (m.kind !== "exercise" || typeof m.exercise_id !== "string" || !pattern) return null;
  const equipment = typeof m.equipment === "string" ? m.equipment : null;
  return {
    id: m.exercise_id,
    name: typeof m.name === "string" ? m.name : m.exercise_id,
    tracked: false,
    pattern,
    compound: m.mechanic === "compound",
    machine: equipment === "machine" || equipment === "cable",
    equipment,
    level: libraryLevel(m.level),
    muscles,
    loads: (m.loads as string[] | undefined) ?? [],
    chunkId: hit.id,
    similarity: hit.similarity,
    tasteSimilarity: hit.tasteSimilarity,
  };
}

export const chunkIdOf = (exerciseId: string) => `exercise:${TRACKED[exerciseId]?.twin ?? exerciseId}#0`;

// ---- Picking ----

function patternsFor(dayCount: number, index: number, perDay: number): Pattern[] {
  const template = dayCount >= 4 ? (index % 2 === 0 ? UPPER : LOWER) : FULL_BODY;
  return template.slice(0, perDay);
}

function orderForLevel<T extends { exerciseId: string }>(
  items: T[],
  level: Level,
  byId: Map<string, Candidate>,
): T[] {
  if (level !== "beginner") return items;
  const first = (i: T) => (byId.get(i.exerciseId)?.compound || byId.get(i.exerciseId)?.machine ? 0 : 1);
  return [...items].sort((a, b) => first(a) - first(b)); // stable: keeps the draft's order otherwise
}

interface Context {
  level: Level;
  goals: string[];
  injuries: Injury[];
  history: History;
  candidates: Candidate[];
  byId: Map<string, Candidate>;
  excluded: { id: string; name: string; pattern: Pattern; bodyPart: string }[];
  prescriptions: Map<string, Prescription>;
  noteChunks: ChunkHit[];
  perDay: number;
}

function itemSources(c: Candidate, ctx: Context, bodyParts: string[]): string[] {
  const notes = ctx.noteChunks.filter(
    (n) =>
      bodyParts.includes(n.metadata.body_part as string) &&
      // Every note ends with "When to get checked"; most also have "Limit or avoid".
      /^(limit or avoid|when to get checked)$/i.test(String(n.metadata.section)),
  );
  return [...(c.chunkId ? [c.chunkId] : []), ...notes.map((n) => n.id)];
}

function swapNoteFor(
  pick: Candidate,
  natural: Candidate | undefined,
  ctx: Context,
  pattern: Pattern,
): string | null {
  if (natural && natural.id !== pick.id && natural.preference?.rating === "dislike") {
    return `${pick.name} instead of ${natural.name}, which you gave a thumbs down`;
  }
  const out = ctx.excluded.find((e) => e.pattern === pattern && e.id !== pick.id);
  return out ? `${pick.name} instead of ${out.name.toLowerCase()} for your ${titleCase(out.bodyPart)}` : null;
}

function decorate(
  item: DraftItem,
  c: Candidate,
  ctx: Context,
  pattern: Pattern,
  natural?: Candidate,
): DraftItem {
  const swap = swapNoteFor(c, natural, ctx, pattern);
  const swappedFor = swap ? ctx.excluded.find((e) => e.pattern === pattern)?.bodyPart : undefined;
  const parts = [...c.adaptedFor.map((a) => a.bodyPart), ...(swappedFor ? [swappedFor] : [])];
  return {
    ...item,
    swapNote: item.swapNote ?? swap,
    safetyNote: c.adaptedFor.map((a) => a.note).join(" ") || null,
    sources: [...new Set([...item.sources, ...itemSources(c, ctx, parts)])],
  };
}

/** The deterministic plan: also the fallback and the filler for the LLM's draft. */
export function rulesPlan(days: number[], ctx: Context): DraftItem[] {
  const uses = new Map<string, number>();
  const items: DraftItem[] = [];
  days.forEach((day, index) => {
    const used = new Set<string>();
    const dayItems: DraftItem[] = [];
    for (const pattern of patternsFor(days.length, index, ctx.perDay)) {
      const pool = ctx.candidates.filter((c) => !used.has(c.id));
      const ofPattern = pool.filter((c) => c.pattern === pattern);
      const choices = ofPattern.length ? ofPattern : pool;
      if (!choices.length) break;
      // A disliked exercise is used only when nothing else fits the slot.
      const notDisliked = choices.filter((c) => c.preference?.rating !== "dislike");
      const pickFrom = notDisliked.length ? notDisliked : choices;
      // Spread the week: each earlier use this week costs a little.
      const value = (c: Candidate, s: number) => s - 0.2 * (uses.get(c.id) ?? 0);
      const pick = pickFrom.reduce((a, b) => (value(b, b.score) > value(a, a.score) ? b : a));
      const natural = choices.reduce((a, b) => (value(b, b.baseScore) > value(a, a.baseScore) ? b : a));
      used.add(pick.id);
      uses.set(pick.id, (uses.get(pick.id) ?? 0) + 1);
      const p = ctx.prescriptions.get(pick.id)!;
      const liked = pick.preference?.rating === "like" ? " You gave it a thumbs up." : "";
      dayItems.push(
        decorate(
          {
            day,
            exerciseId: pick.id,
            sets: p.sets,
            reps: p.reps,
            reason: p.reason + liked,
            swapNote: null,
            safetyNote: null,
            sources: [],
          },
          pick,
          ctx,
          pattern, // the slot it fills, so "Push-up instead of squat for your knee" reads right
          natural,
        ),
      );
    }
    items.push(...orderForLevel(dayItems, ctx.level, ctx.byId));
  });
  return items;
}

// ---- LLM draft ----

const SYSTEM = [
  "You plan one week of gym training for one lifter, as JSON.",
  "Use only exercises from `candidates`; they are already checked against the lifter's injuries.",
  "Plan exactly the days listed in `days`, each with between per_day.min and per_day.max exercises, no exercise twice in a day.",
  "Use each candidate's `suggested` sets and reps or fewer, never more.",
  "Cover lower body, push, pull and core across the week, and vary exercises between training days when there is an alternative.",
  "Prefer camera-tracked exercises and ones marked liked or habit; avoid ones marked disliked.",
  "For a beginner, list compound and machine exercises first each day.",
  "reason: one sentence under 20 words on why it fits this lifter, from their goals or history.",
  "Describe, never command: no imperative verbs, no 'should', 'must', 'never' or 'always', no exclamation marks, no medical claims.",
  "sources: the candidate's `source` id and any `notes` ids that support the choice.",
].join(" ");

interface LlmPlan {
  days: {
    day: number;
    items: { exercise_id: string; sets: number; reps: number; reason: string; sources: string[] }[];
  }[];
}

function planSchema(ids: string[], days: number[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["days"],
    properties: {
      days: {
        type: "array",
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["day", "items"],
          properties: {
            day: { type: "integer", enum: days },
            items: {
              type: "array",
              minItems: 1,
              maxItems: MAX_PER_DAY,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["exercise_id", "sets", "reps", "reason", "sources"],
                properties: {
                  exercise_id: { type: "string", enum: ids },
                  sets: { type: "integer" },
                  reps: { type: "integer" },
                  reason: { type: "string", maxLength: MAX_REASON_CHARS },
                  sources: { type: "array", maxItems: 6, items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  };
}

function describeHistory(h: ExerciseHistory | undefined): string | null {
  if (!h?.sessions) return null;
  const clean = h.clean === null ? "" : `, ${pct(h.clean)} clean`;
  const prs = h.prs ? `, ${h.prs} PR${h.prs > 1 ? "s" : ""}` : "";
  return `${h.sessions} session${h.sessions > 1 ? "s" : ""} in 6 weeks${clean}${prs}`;
}

function preferenceLabel(p: Preference | null): string {
  if (p?.rating === "like") return "liked";
  if (p?.rating === "dislike") return "disliked";
  if ((p?.implicit ?? 0) >= 0.3) return "habit";
  if ((p?.implicit ?? 0) <= -0.3) return "often skipped";
  return "neutral";
}

export function llmInput(days: number[], ctx: Context) {
  const pool = [...ctx.candidates].sort((a, b) => b.score - a.score).slice(0, MAX_LLM_CANDIDATES);
  return {
    pool,
    user: JSON.stringify({
      lifter: {
        level: ctx.level,
        goals: ctx.goals,
        injuries: ctx.injuries.map((i) => ({ body_part: i.bodyPart, severity: i.severity })),
        last_plan_done: ctx.history.lastPlan ? pct(ctx.history.lastPlan.adherence) : null,
      },
      days: days.map((day) => ({ day, weekday: WEEKDAYS[day] })),
      per_day: { min: Math.min(MIN_PER_DAY, ctx.perDay), max: ctx.perDay },
      candidates: pool.map((c) => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        camera_tracked: c.tracked,
        compound: c.compound,
        equipment: c.equipment,
        preference: preferenceLabel(c.preference),
        history: describeHistory(ctx.history.exercises.get(c.id)),
        suggested: { sets: ctx.prescriptions.get(c.id)!.sets, reps: ctx.prescriptions.get(c.id)!.reps },
        adapted_for: c.adaptedFor.map((a) => a.bodyPart),
        source: c.chunkId,
      })),
      notes: ctx.noteChunks.map((n) => ({ id: n.id, text: String(n.metadata.section ?? "") })),
    }),
  };
}

export function reasonProblems(text: string): string[] {
  const problems = checkNote(text, banned, { placeholders: [] });
  if (!text.trim()) problems.push("empty");
  if (text.length > MAX_REASON_CHARS) problems.push("too long");
  return problems;
}

/**
 * The safety check on the LLM's draft. Anything it can't use is replaced from the rules plan, so
 * the result always satisfies the same rules as a rules plan. Returns null if no LLM day survives.
 */
export function checkDraft(
  draft: LlmPlan,
  days: number[],
  ctx: Context,
  rules: DraftItem[],
): DraftItem[] | null {
  const allowedSources = new Set([
    ...ctx.candidates.map((c) => c.chunkId),
    ...ctx.noteChunks.map((n) => n.id),
  ]);
  const [lo] = REP_RANGE[ctx.level];
  const out: DraftItem[] = [];
  let kept = 0;
  for (const day of days) {
    const fromLlm = draft.days.find((d) => d.day === day)?.items ?? [];
    const used = new Set<string>();
    const dayItems: DraftItem[] = [];
    for (const it of fromLlm) {
      const c = ctx.byId.get(it.exercise_id);
      if (!c || used.has(c.id) || dayItems.length >= ctx.perDay) continue;
      // Disliked, with a liked-or-neutral alternative of the same pattern free that day: swap it.
      let pick = c;
      let swapNote: string | null = null;
      if (c.preference?.rating === "dislike") {
        const alt = ctx.candidates
          .filter((x) => x.pattern === c.pattern && x.preference?.rating !== "dislike" && !used.has(x.id))
          .filter((x) => !fromLlm.some((o) => o.exercise_id === x.id))
          .sort((a, b) => b.score - a.score)[0];
        if (alt) {
          pick = alt;
          swapNote = `${alt.name} instead of ${c.name}, which you gave a thumbs down`;
        }
      }
      const ceiling = ctx.prescriptions.get(pick.id)!;
      const reason = pick === c && !reasonProblems(it.reason).length ? it.reason.trim() : ceiling.reason;
      used.add(pick.id);
      dayItems.push(
        decorate(
          {
            day,
            exerciseId: pick.id,
            sets: Math.min(ceiling.sets, Math.max(1, Math.round(it.sets))),
            reps: Math.min(ceiling.reps, Math.max(lo, Math.round(it.reps))),
            reason,
            swapNote,
            safetyNote: null,
            sources: pick === c ? it.sources.filter((s) => allowedSources.has(s)) : [],
          },
          pick,
          ctx,
          pick.pattern,
        ),
      );
    }
    if (dayItems.length) kept += 1;
    // Too few: top up from the rules plan's day.
    for (const r of rules.filter((x) => x.day === day)) {
      if (dayItems.length >= Math.min(MIN_PER_DAY, ctx.perDay)) break;
      if (!used.has(r.exerciseId)) {
        used.add(r.exerciseId);
        dayItems.push(r);
      }
    }
    out.push(...orderForLevel(dayItems, ctx.level, ctx.byId));
  }
  return kept ? out : null;
}

// ---- Generate ----

export interface GenerateInput {
  userId: string;
  timeZone: string;
  today: string; // the user's local date
}

export async function generatePlan(db: Db, deps: PlannerDeps, input: GenerateInput) {
  const log = deps.log ?? silent;
  const { userId, timeZone, today } = input;

  if (await activePlan(db, userId)) {
    throw new HttpError(
      409,
      "rehab_plan_active",
      "You're following a rehab plan from your physio, so gym plans are paused. Mark the rehab plan done or paused to get a gym plan.",
    );
  }

  const weekOf = mondayOf(today);
  const todayIndex = daysBetween(weekOf, today);
  const [profileRow] = await db
    .select({
      level: profiles.experienceLevel,
      goals: profiles.goals,
      trainingSchedule: profiles.trainingSchedule,
      schedule: profiles.schedule,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const level: Level = profileRow?.level ?? "beginner";
  const goals = profileRow?.goals ?? [];
  const injuryList: Injury[] = await db
    .select({ bodyPart: injuries.bodyPart, severity: injuries.severity })
    .from(injuries)
    .where(eq(injuries.userId, userId));

  // Regenerating keeps the days already past from the plan it replaces.
  const previous = await latestPlan(db, userId, weekOf);
  const carried: DraftItem[] = previous
    ? (await db.select().from(planItems).where(eq(planItems.planId, previous.id)))
        .filter((i) => i.day < todayIndex)
        .map((i) => ({
          day: i.day,
          exerciseId: i.exerciseId,
          sets: i.sets,
          reps: i.reps,
          reason: i.reason,
          swapNote: i.swapNote,
          safetyNote: i.safetyNote,
          sources: i.sources as string[],
          carried: true,
        }))
    : [];
  const days = trainingDays(profileRow?.trainingSchedule ?? null, profileRow?.schedule ?? [], weekOf).filter(
    (d) => d >= todayIndex,
  );
  if (!days.length && !carried.length) {
    throw new HttpError(
      422,
      "no_training_days",
      "There are no training days left this week. A new plan can be made from Monday.",
    );
  }

  const history = await loadHistory(db, userId, weekOf, timeZone, today);
  const prefs = preferences(await loadRatings(db, userId), history.exercises);
  const taste = await rebuildTaste(db, userId, prefs, chunkIdOf);

  // Search query: goals, level and injuries, nudged towards what the user likes.
  let query: number[] | null = null;
  if (deps.embed) {
    try {
      const q = await deps.embed(searchText(level, goals, injuryList), deps.embedTimeoutMs ?? 8_000);
      query = taste ? normalize(q.map((x, i) => x + 0.5 * taste[i]!)) : q;
    } catch (err) {
      log.warn(
        `[planner] query embedding failed, ranking by taste only: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Candidates: tracked exercises with specs, then the library.
  const excluded: Context["excluded"] = [];
  const candidates: Candidate[] = [];
  const add = (c: Omit<Candidate, "score" | "baseScore">) =>
    candidates.push({ ...c, score: rankScore(c, level), baseScore: rankScore(c, level, false) });

  const trackedRows = (
    await db
      .select({
        id: exercises.id,
        name: exercises.name,
        muscles: exercises.muscles,
        spec: exercises.formSpec,
      })
      .from(exercises)
      .where(and(sql`${exercises.formSpec} is not null`, inArray(exercises.id, Object.keys(TRACKED))))
  ).sort((a, b) => a.id.localeCompare(b.id));
  const twinHits = new Map(
    (await searchChunks(db, { query, taste, ids: trackedRows.map((r) => chunkIdOf(r.id)) })).map((h) => [
      h.id,
      h,
    ]),
  );
  for (const row of trackedRows) {
    const t = TRACKED[row.id]!;
    const overrides = ((row.spec as { injury_overrides?: SpecOverrides }).injury_overrides ??
      null) as SpecOverrides | null;
    const verdict = safety(t.loads, overrides, injuryList);
    if (!verdict.ok) {
      excluded.push({ id: row.id, name: row.name, pattern: t.pattern, bodyPart: verdict.bodyPart });
      continue;
    }
    const twin = twinHits.get(chunkIdOf(row.id));
    add({
      id: row.id,
      name: row.name,
      tracked: true,
      pattern: t.pattern,
      compound: t.compound,
      machine: t.machine,
      equipment: null,
      level: "beginner",
      muscles: row.muscles,
      loads: t.loads,
      chunkId: twin?.id ?? null,
      similarity: twin?.similarity ?? null,
      tasteSimilarity: twin?.tasteSimilarity ?? null,
      preference: prefs.get(row.id) ?? null,
      adaptedFor: verdict.adaptedFor,
    });
  }

  const avoid = [...new Set(injuryList.map((i) => i.bodyPart).filter((p) => p !== "other"))];
  const liked = [...prefs.values()]
    .filter((p) => p.score > 0 && !TRACKED[p.exerciseId])
    .map((p) => chunkIdOf(p.exerciseId));
  const twins = new Set(trackedRows.map((r) => chunkIdOf(r.id)));
  const hits = [
    ...(await searchChunks(db, { query, taste, levels: LIBRARY_LEVELS[level], avoid, limit: LIBRARY_POOL })),
    ...(liked.length ? await searchChunks(db, { query, taste, ids: liked }) : []),
  ];
  for (const hit of hits) {
    const c = libraryCandidate(hit);
    // Skip twins of tracked exercises (the tracked one is preferred) and anything already in.
    if (!c || twins.has(hit.id) || candidates.some((x) => x.id === c.id)) continue;
    if (hit.metadata.category !== "strength" || !LIBRARY_LEVELS[level].includes(String(hit.metadata.level)))
      continue;
    if (!safety(c.loads, null, injuryList).ok) continue; // the search filtered these; check again in code
    add({ ...c, preference: prefs.get(c.id) ?? null, adaptedFor: [] });
  }
  if (!candidates.length && !carried.length) {
    throw new HttpError(
      503,
      "no_exercises",
      "No exercises are available to plan with yet. Load the specs (npm run db:load-specs) or the exercise library (rag:ingest).",
    );
  }

  const noteChunks = avoid.length
    ? await searchChunks(db, { query: null, taste: null, ids: await injuryNoteIds(db, avoid) })
    : [];
  const adherence = history.lastPlan?.adherence ?? null;
  const ctx: Context = {
    level,
    goals,
    injuries: injuryList,
    history,
    candidates,
    byId: new Map(candidates.map((c) => [c.id, c])),
    excluded,
    prescriptions: new Map(
      candidates.map((c) => [
        c.id,
        prescribe(c, history.exercises.get(c.id), { level, goals, adherence, rom: history.rom }),
      ]),
    ),
    noteChunks,
    perDay: adherence !== null && adherence < 0.5 ? MIN_PER_DAY : PER_DAY[level],
  };

  const rules = rulesPlan(days, ctx);
  let source: "llm" | "rules" = "rules";
  let drafted = rules;
  if (deps.llm && days.length && candidates.length) {
    try {
      const { pool, user } = llmInput(days, ctx);
      const { data } = await deps.llm.generateJson<LlmPlan>({
        schema: planSchema(
          pool.map((c) => c.id),
          days,
        ),
        schemaName: "weekly_plan",
        system: SYSTEM,
        user,
        timeoutMs: deps.llmTimeoutMs ?? 20_000,
        maxTokens: 4096, // gpt-oss reasons first, and the reasoning counts against this
        temperature: 0.3,
      });
      const checked = checkDraft(data, days, ctx, rules);
      if (checked) {
        drafted = checked;
        source = "llm";
      } else log.warn("[planner] LLM draft had no usable day; using the rules plan");
    } catch (err) {
      log.warn(
        `[planner] LLM failed, using the rules plan: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const items = [...carried, ...drafted];
  const capped = capVolume(items, history.volumeCap);
  const notes = planNotes(ctx, items, capped);

  const sourceIds = [...new Set(items.flatMap((i) => i.sources))];
  const titles = await chunkTitles(db, sourceIds);
  const planId = await db.transaction(async (tx) => {
    // Library exercises go into the exercises table on first use, without a form spec.
    const library = candidates.filter((c) => !c.tracked && items.some((i) => i.exerciseId === c.id));
    if (library.length) {
      await tx
        .insert(exercises)
        .values(library.map((c) => ({ id: c.id, name: c.name, muscles: c.muscles, level: c.level })))
        .onConflictDoNothing();
    }
    const [plan] = await tx
      .insert(plans)
      .values({
        userId,
        weekOf,
        source,
        notes,
        history: historySummary(history),
        aiSources: sourceIds.map((id) => ({ id, title: titles.get(id) ?? id })),
      })
      .returning({ id: plans.id });
    const ordered = [...items].sort((a, b) => a.day - b.day);
    if (ordered.length) {
      await tx.insert(planItems).values(
        ordered.map((i, n) => ({
          planId: plan!.id,
          exerciseId: i.exerciseId,
          day: i.day,
          position: n - ordered.findIndex((x) => x.day === i.day),
          sets: i.sets,
          reps: i.reps,
          reason: i.reason,
          swapNote: i.swapNote,
          safetyNote: i.safetyNote,
          sources: i.sources,
        })),
      );
    }
    return plan!.id;
  });
  return (await planView(db, userId, planId))!;
}

async function injuryNoteIds(db: Db, bodyParts: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: docChunks.id })
    .from(docChunks)
    .where(
      and(
        sql`${docChunks.metadata}->>'kind' = 'injury_note'`,
        inArray(sql`${docChunks.metadata}->>'body_part'`, bodyParts),
      ),
    );
  return rows.map((r) => r.id);
}

async function chunkTitles(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: docChunks.id, metadata: docChunks.metadata })
    .from(docChunks)
    .where(inArray(docChunks.id, ids));
  return new Map(
    rows.map((r) => {
      const m = r.metadata as Record<string, unknown>;
      return [r.id, m.kind === "injury_note" ? `${m.title}: ${m.section}` : String(m.name ?? r.id)];
    }),
  );
}

function planNotes(ctx: Context, items: DraftItem[], capped: boolean): string[] {
  const notes: string[] = [];
  // A plan made with injury notes retrieved carries the consult-a-doctor disclaimer (Architecture §13).
  if (ctx.noteChunks.length) notes.push(ADVICE_DISCLAIMER);
  const parts = [...new Set(ctx.injuries.map((i) => i.bodyPart).filter((p) => p !== "other"))];
  if (parts.length) {
    notes.push(
      `Planned around your ${parts.map(titleCase).join(" and ")}. Any pain is worth raising with your physio or a doctor before carrying on.`,
    );
  }
  if (ctx.injuries.some((i) => i.bodyPart === "other")) {
    notes.push(
      "One of your injuries has no body part, so nothing was left out for it. Adding the body part lets the plan work around it, and a physio can say what suits it.",
    );
  }
  for (const part of new Set(ctx.excluded.map((e) => e.bodyPart))) {
    const names = ctx.excluded.filter((e) => e.bodyPart === part).map((e) => e.name);
    notes.push(`Left out for your ${titleCase(part)}: ${names.join(", ")}.`);
  }
  if (capped && ctx.history.baseline && ctx.history.volumeCap !== null) {
    notes.push(
      `This week is held to ${ctx.history.volumeCap} reps, 10% above the ${ctx.history.baseline.reps} you did the week of ${ctx.history.baseline.weekOf}.`,
    );
  }
  const last = ctx.history.lastPlan;
  if (last && last.adherence < 0.5) {
    notes.push(`About ${pct(last.adherence)} of last plan was done, so this week has fewer exercises a day.`);
  }
  const days = new Set(items.map((i) => i.day));
  if ([...days].some((d) => items.filter((i) => i.day === d).length < MIN_PER_DAY) && !capped) {
    notes.push(
      "Some days are shorter because only a few exercises are safe and available for you right now.",
    );
  }
  return notes;
}

// ---- Read ----

async function latestPlan(db: Db, userId: string, weekOf: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.weekOf, weekOf)))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return plan ?? null;
}

/** The plan for the week containing `today`, or null. */
export async function currentPlan(db: Db, userId: string, today: string) {
  const plan = await latestPlan(db, userId, mondayOf(today));
  return plan ? planView(db, userId, plan.id) : null;
}

export async function planView(db: Db, userId: string, planId: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)));
  if (!plan) return null;
  const rows = await db
    .select({
      id: planItems.id,
      day: planItems.day,
      position: planItems.position,
      sets: planItems.sets,
      reps: planItems.reps,
      reason: planItems.reason,
      swapNote: planItems.swapNote,
      safetyNote: planItems.safetyNote,
      sources: planItems.sources,
      exercise: {
        id: exercises.id,
        name: exercises.name,
        tracked: sql<boolean>`${exercises.formSpec} is not null`,
      },
      rating: exercisePreferences.rating,
    })
    .from(planItems)
    .innerJoin(exercises, eq(exercises.id, planItems.exerciseId))
    .leftJoin(
      exercisePreferences,
      and(eq(exercisePreferences.exerciseId, planItems.exerciseId), eq(exercisePreferences.userId, userId)),
    )
    .where(eq(planItems.planId, plan.id))
    .orderBy(planItems.day, planItems.position);
  const titles = new Map((plan.aiSources as { id: string; title: string }[]).map((s) => [s.id, s.title]));
  const dayList = [...new Set(rows.map((r) => r.day))];
  const { aiSources, ...rest } = plan;
  return {
    ...rest,
    sources: aiSources,
    days: dayList.map((day) => ({
      day,
      weekday: WEEKDAYS[day],
      date: addDays(plan.weekOf, day),
      items: rows
        .filter((r) => r.day === day)
        .map(({ day: _d, sources, ...item }) => ({
          ...item,
          sources: (sources as string[]).map((id) => ({ id, title: titles.get(id) ?? id })),
        })),
    })),
  };
}
