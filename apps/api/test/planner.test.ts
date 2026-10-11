// AI-12 / BE-08: the RAG planner and its endpoints. Real migrations, specs and injury notes on
// PGlite; a bag-of-words embedder stands in for bge-small and a scripted fake for gpt-oss.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as rag from "../../../rag/ingest.js";
import { schema, type Db } from "../src/db.js";
import { EMBED_DIM, EMBED_MODEL, QUERY_PREFIX } from "../src/integrations/huggingface/embed.js";
import type { GenerateJsonInput } from "../src/integrations/huggingface/llm.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";
import {
  capVolume,
  prescribe,
  safety,
  trainingDays,
  type DraftItem,
  type PlannerDeps,
} from "../src/services/planner.js";
import { combine, implicitScore } from "../src/services/preferences.js";
import type { ExerciseHistory } from "../src/services/planHistory.js";
import { createTestDb, setup } from "./helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MONDAY = new Date("2026-10-05T12:00:00Z");
const WEDNESDAY = new Date("2026-10-07T12:00:00Z");
const SUNDAY = new Date("2026-10-11T12:00:00Z");

// ---- Units ----

const history = (over: Partial<ExerciseHistory> = {}): ExerciseHistory => ({
  exerciseId: "squat",
  sessions: 2,
  weightedSessions: 1.8,
  lastDoneDaysAgo: 3,
  setsPerSession: 3,
  repsPerSet: 8,
  clean: 0.95,
  cleanRecent: 0.95,
  cleanBefore: null,
  medals: { gold: 2, silver: 0, bronze: 0 },
  prs: 0,
  planned: 0,
  done: 0,
  ...over,
});

describe("planner rules", () => {
  it("reads the FE-03 schedule (0 = Sunday) into plan days (0 = Monday)", () => {
    expect(trainingDays({ kind: "weekly", days: [0, 1, 3, 5] }, [], "2026-10-05")).toEqual([0, 2, 4, 6]);
    // Every 3 days from Saturday 2026-10-03: Tuesday 6th, Friday 9th.
    expect(
      trainingDays({ kind: "interval", every_days: 3, start_date: "2026-10-03" }, [], "2026-10-05"),
    ).toEqual([1, 4]);
    expect(
      trainingDays({ kind: "interval", every_days: 2, start_date: "2026-10-09" }, [], "2026-10-05"),
    ).toEqual([4, 6]);
    expect(trainingDays(null, ["tue_am", "thu_pm", "tue_eve"], "2026-10-05")).toEqual([1, 3]);
    expect(trainingDays(null, [], "2026-10-05")).toEqual([0, 2, 4]);
  });

  it("drops what loads an injured joint, unless a spec adapts it for a mild or moderate injury", () => {
    const overrides = { knee: { extra_note: "Shorter depth for a recovering knee." } };
    expect(safety(["knee", "hip"], overrides, [{ bodyPart: "knee", severity: "mild" }])).toEqual({
      ok: true,
      adaptedFor: [{ bodyPart: "knee", note: "Shorter depth for a recovering knee." }],
    });
    expect(safety(["knee"], overrides, [{ bodyPart: "knee", severity: "severe" }])).toEqual({
      ok: false,
      bodyPart: "knee",
    });
    expect(safety(["knee"], null, [{ bodyPart: "knee", severity: "mild" }])).toEqual({
      ok: false,
      bodyPart: "knee",
    });
    expect(safety(["ankle"], overrides, [{ bodyPart: "ankle", severity: "mild" }])).toEqual({
      ok: false,
      bodyPart: "ankle",
    });
    expect(safety(["knee"], null, [{ bodyPart: "other", severity: "severe" }])).toEqual({
      ok: true,
      adaptedFor: [],
    });
  });

  it("caps weekly reps, trimming reps before sets and never touching carried days", () => {
    const item = (sets: number, reps: number, carried = false): DraftItem => ({
      day: 0,
      exerciseId: "x",
      sets,
      reps,
      reason: null,
      swapNote: null,
      safetyNote: null,
      sources: [],
      carried,
    });
    const items = [item(3, 10, true), item(3, 10), item(3, 10)];
    expect(capVolume(items, 66)).toBe(true);
    expect(items.reduce((s, i) => s + i.sets * i.reps, 0)).toBeLessThanOrEqual(66);
    expect(items[0]).toMatchObject({ sets: 3, reps: 10 });
    expect(capVolume([item(3, 10)], null)).toBe(false);
    const tiny = [item(3, 10), item(3, 10)];
    capVolume(tiny, 5);
    expect(tiny).toEqual([expect.objectContaining({ sets: 1, reps: 5 })]); // the cap wins over 3 a day
  });

  it("progresses clean, medalled work, eases off when form or range drops, and starts new exercises", () => {
    const ctx = { level: "beginner" as const, goals: [], adherence: 1, rom: [] };
    const squat = { id: "squat", tracked: true };
    expect(prescribe(squat, history(), ctx)).toMatchObject({
      sets: 3,
      reps: 10,
      reason: "Up from 3 × 8: 95% of recent reps were clean.",
    });
    expect(prescribe(squat, history({ cleanRecent: 0.4, clean: 0.4 }), ctx)).toMatchObject({ reps: 6 });
    expect(prescribe(squat, history({ cleanRecent: 0.6, cleanBefore: 0.9 }), ctx).reason).toMatch(/dipped/);
    expect(
      prescribe(squat, history(), {
        ...ctx,
        rom: [{ angle: "knee", side: "left", week: "2026-09-28", changeDeg: -8 }],
      }).reason,
    ).toBe("A little lighter: left knee range dipped 8° recently.");
    expect(prescribe(squat, history(), { ...ctx, adherence: 0.5 }).reason).toBe(
      "Same as recent sessions, 3 × 8.",
    );
    expect(prescribe(squat, undefined, ctx)).toMatchObject({ sets: 3, reps: 10 });
    expect(prescribe(squat, undefined, { ...ctx, level: "advanced", goals: ["strength"] })).toMatchObject({
      sets: 4,
      reps: 6,
    });
  });

  it("scores likes from habits and ratings; a thumbs down always ends up negative", () => {
    expect(implicitScore(history({ sessions: 0, weightedSessions: 0, clean: null, planned: 0 }))).toBeNull();
    expect(
      implicitScore(history({ sessions: 0, weightedSessions: 0, clean: null, planned: 3, done: 0 })),
    ).toBe(-1);
    expect(implicitScore(history({ weightedSessions: 4, clean: 1, planned: 2, done: 2 }))).toBe(1);
    expect(combine("dislike", 1)).toBeLessThan(0);
    expect(combine("like", -1)).toBeGreaterThan(0);
    expect(combine(null, 0.4)).toBe(0.4);
  });

  it("embeds queries the same way rag/ingest.ts embedded the chunks", () => {
    expect([EMBED_MODEL, EMBED_DIM, QUERY_PREFIX]).toEqual([
      rag.EMBED_MODEL,
      rag.EMBED_DIM,
      rag.QUERY_PREFIX,
    ]);
  });
});

// ---- Endpoints ----

async function profile(t: Awaited<ReturnType<typeof setup>>, user: string, body: object = {}) {
  const res = await (
    await t.as(user)
  ).put("/me/profile", {
    experience_level: "beginner",
    training_schedule: { kind: "weekly", days: [1, 3, 5] },
    ...body,
  });
  expect(res.status).toBe(200);
}

async function trained(
  db: Db,
  userId: string,
  at: string,
  exerciseId: string,
  sets: number,
  reps: number,
  clean = 0.95,
) {
  const when = new Date(at);
  const [session] = await db
    .insert(schema.sessions)
    .values({ userId, inferenceMode: "coreml", startedAt: when, finishedAt: when })
    .returning();
  await db.insert(schema.sets).values(
    Array.from({ length: sets }, (_, i) => ({
      sessionId: session!.id,
      position: i,
      exerciseId,
      reps,
      cleanShare: clean,
      medal: "gold" as const,
      createdAt: when,
    })),
  );
}

type Item = {
  exercise: { id: string; tracked: boolean };
  sets: number;
  reps: number;
  reason: string;
  swap_note: string | null;
  safety_note: string | null;
  rating: string | null;
  sources: { id: string; title: string }[];
};
type Plan = {
  id: string;
  week_of: string;
  source: string;
  notes: string[];
  history: Record<string, unknown>;
  sources: { id: string; title: string }[];
  days: { day: number; date: string; weekday: string; items: Item[] }[];
};
const allItems = (plan: Plan) => plan.days.flatMap((d) => d.items);
const ids = (plan: Plan) => allItems(plan).map((i) => i.exercise.id);
const volume = (plan: Plan) => allItems(plan).reduce((s, i) => s + i.sets * i.reps, 0);

describe("plans with the camera-tracked exercises only", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup({ planner: { llm: null, embed: null, now: () => MONDAY } });
    await loadSpecs(t.db, path.join(ROOT, "specs/exercises"));
  });
  afterAll(() => t.close());

  it("makes this week's rules plan on the user's days, 3 a day, compound first, and serves it as current", async () => {
    await profile(t, "p-basic");
    const me = await t.as("p-basic");
    expect((await me.get("/plans/current")).status).toBe(404);

    const res = await me.post("/plans/generate");
    expect(res.status).toBe(201);
    const plan = res.body as Plan;
    expect(plan).toMatchObject({ week_of: "2026-10-05", source: "rules", notes: [] });
    expect(plan.days.map((d) => [d.day, d.weekday, d.date])).toEqual([
      [0, "Monday", "2026-10-05"],
      [2, "Wednesday", "2026-10-07"],
      [4, "Friday", "2026-10-09"],
    ]);
    for (const day of plan.days) {
      expect(day.items).toHaveLength(3);
      expect(day.items.every((i) => i.exercise.tracked)).toBe(true);
      expect(day.items.at(-1)!.exercise.id).toBe("bicep_curl"); // the one isolation move goes last
      expect(day.items[0]).toMatchObject({ sets: 3, reps: 10, reason: "New this week, starting at 3 × 10." });
    }
    // The week varies: Monday's and Wednesday's lower-body moves differ.
    expect(plan.days[0]!.items[0]!.exercise.id).not.toBe(plan.days[1]!.items[0]!.exercise.id);
    expect(plan.history).toMatchObject({ window_weeks: 6, baseline_reps: null, volume_cap: null });

    const current = await me.get("/plans/current");
    expect(current.body).toEqual(plan);
    expect((await (await t.as("p-other")).get("/plans/current")).status).toBe(404);
  });

  it("adapts tracked exercises for a mild knee and leaves them out for a severe one", async () => {
    await profile(t, "p-knee");
    const me = await t.as("p-knee");
    await me.post("/me/injuries", { body_part: "knee", severity: "mild" });
    const mild = (await me.post("/plans/generate")).body as Plan;
    const squats = allItems(mild).filter((i) => ["squat", "lunge"].includes(i.exercise.id));
    expect(squats.length).toBeGreaterThan(0);
    for (const i of squats) expect(i.safety_note).toMatch(/recovering knee/);
    expect(mild.notes[0]).toMatch(/^Planned around your knee\. Any pain is worth raising with your physio/);

    await profile(t, "p-knee-bad");
    const bad = await t.as("p-knee-bad");
    await bad.post("/me/injuries", { body_part: "knee", severity: "severe" });
    const plan = (await bad.post("/plans/generate")).body as Plan;
    expect(ids(plan)).not.toContain("squat");
    expect(ids(plan)).not.toContain("lunge");
    expect(plan.notes).toContain("Left out for your knee: Lunge, Squat.");
    expect(
      allItems(plan).some((i) => /instead of (lunge|squat) for your knee$/.test(i.swap_note ?? "")),
    ).toBe(true);
  });

  it("swaps a disliked exercise for one of the same kind, and marks liked ones", async () => {
    await profile(t, "p-taste");
    const me = await t.as("p-taste");
    expect((await me.put("/me/exercise-preferences/squat", { rating: "dislike" })).body).toMatchObject({
      exercise_id: "squat",
      rating: "dislike",
    });
    expect((await me.put("/me/exercise-preferences/push_up", { rating: "like" })).status).toBe(200);
    const plan = (await me.post("/plans/generate")).body as Plan;
    expect(ids(plan)).not.toContain("squat");
    expect(
      allItems(plan).some((i) => i.swap_note === "Lunge instead of Squat, which you gave a thumbs down"),
    ).toBe(true);
    const pushUps = allItems(plan).filter((i) => i.exercise.id === "push_up");
    expect(pushUps.length).toBe(2); // liked, so on two of three days; variety keeps the third
    expect(pushUps[0]).toMatchObject({ rating: "like", reason: expect.stringMatching(/thumbs up\.$/) });

    expect((await me.put("/me/exercise-preferences/squat", { rating: "neutral" })).body).toEqual({
      exercise_id: "squat",
      rating: "neutral",
      updated_at: null,
    });
    expect((await me.get("/me/exercise-preferences")).body).toEqual([
      expect.objectContaining({ exercise_id: "push_up", name: "Push-up", tracked: true, rating: "like" }),
    ]);
    expect((await me.put("/me/exercise-preferences/deadlift", { rating: "like" })).status).toBe(404);
    expect((await me.put("/me/exercise-preferences/squat", { rating: "love" })).status).toBe(400);
    expect((await me.put("/me/exercise-preferences/bad%20id", { rating: "like" })).status).toBe(400);
  });

  it("builds on the last six weeks: progression, the +10% volume cap and last week's adherence", async () => {
    await profile(t, "p-hist");
    await (await t.as("p-hist")).get("/me/profile");
    // Last week: two clean squat sessions of 3 × 8 = 48 reps, so this week allows 53.
    await trained(t.db, "p-hist", "2026-09-29T17:00:00Z", "squat", 3, 8);
    await trained(t.db, "p-hist", "2026-10-02T17:00:00Z", "squat", 3, 8);
    const plan = (await (await t.as("p-hist")).post("/plans/generate")).body as Plan;
    expect(plan.history).toMatchObject({ baseline_week_of: "2026-09-28", baseline_reps: 48, volume_cap: 53 });
    expect(volume(plan)).toBeLessThanOrEqual(53);
    expect(plan.notes).toContain(
      "This week is held to 53 reps, 10% above the 48 you did the week of 2026-09-28.",
    );

    // A plan last week that wasn't followed: fewer exercises a day for an intermediate lifter.
    await profile(t, "p-skip", { experience_level: "intermediate" });
    const [old] = await t.db
      .insert(schema.plans)
      .values({ userId: "p-skip", weekOf: "2026-09-28" })
      .returning();
    await t.db.insert(schema.planItems).values(
      [0, 2, 4].map((day) => ({
        planId: old!.id,
        exerciseId: "lunge",
        day,
        position: 0,
        sets: 3,
        reps: 10,
      })),
    );
    const skipped = (await (await t.as("p-skip")).post("/plans/generate")).body as Plan;
    expect(skipped.history).toMatchObject({ last_plan_adherence: 0 });
    expect(skipped.days.every((d) => d.items.length === 3)).toBe(true);
    expect(skipped.notes).toContain(
      "About 0% of last plan was done, so this week has fewer exercises a day.",
    );
  });

  it("keeps the days already past when the plan is regenerated mid-week", async () => {
    await profile(t, "p-regen");
    const first = (await (await t.as("p-regen")).post("/plans/generate")).body as Plan;
    const wednesday = await setup({
      db: t.db,
      close: async () => {},
      planner: { llm: null, embed: null, now: () => WEDNESDAY },
    });
    const token = await wednesday.keys.sign("p-regen");
    const res = await request(wednesday.app).post("/plans/generate").set("Authorization", `Bearer ${token}`);
    const second = res.body as Plan;
    expect(second.id).not.toBe(first.id);
    expect(second.days.map((d) => d.day)).toEqual([0, 2, 4]);
    expect(second.days[0]!.items.map((i) => i.exercise.id)).toEqual(
      first.days[0]!.items.map((i) => i.exercise.id),
    );
    const rows = await t.db.select().from(schema.plans).where(eq(schema.plans.userId, "p-regen"));
    expect(rows).toHaveLength(2); // the old plan stays as history
    const current = await request(wednesday.app)
      .get("/plans/current")
      .set("Authorization", `Bearer ${token}`);
    expect(current.body.id).toBe(second.id);
  });

  it("refuses while a rehab plan is active, and when no training days are left", async () => {
    await profile(t, "p-rehab");
    await t.db.insert(schema.rehabPlans).values({ userId: "p-rehab", startOn: "2026-10-01" });
    const res = await (await t.as("p-rehab")).post("/plans/generate");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "rehab_plan_active",
      message: expect.stringMatching(/rehab plan/),
    });

    await profile(t, "p-late", { training_schedule: { kind: "weekly", days: [1] } });
    const sunday = await setup({
      db: t.db,
      close: async () => {},
      planner: { llm: null, embed: null, now: () => SUNDAY },
    });
    const late = await request(sunday.app)
      .post("/plans/generate")
      .set("Authorization", `Bearer ${await sunday.keys.sign("p-late")}`);
    expect(late.status).toBe(422);
    expect(late.body.error).toBe("no_training_days");
    expect((await (await t.as("p-late")).post("/plans/generate?tz=%2B01:00")).status).toBe(400);
  });
});

// ---- With the exercise library and injury notes ----

const ex = (
  id: string,
  level: string,
  category: string,
  equipment: string | null,
  mechanic: string | null,
  primary: string[],
  secondary: string[] = [],
) => ({
  id,
  name: id.replace(/_/g, " "),
  force: "push",
  level,
  mechanic,
  equipment,
  primaryMuscles: primary,
  secondaryMuscles: secondary,
  instructions: [`${id.replace(/_/g, " ")} exercise.`],
  category,
});

const LIBRARY = [
  ex("Bodyweight_Squat", "beginner", "strength", "body only", "compound", ["quadriceps"], ["glutes"]),
  ex("Dumbbell_Lunges", "beginner", "strength", "dumbbell", "compound", ["quadriceps"], ["glutes"]),
  ex("Pushups", "beginner", "strength", "body only", "compound", ["chest"], ["triceps"]),
  ex("Standing_Dumbbell_Press", "beginner", "strength", "dumbbell", "compound", ["shoulders"], ["triceps"]),
  ex("Dumbbell_Bicep_Curl", "beginner", "strength", "dumbbell", "isolation", ["biceps"], ["forearms"]),
  ex("Leg_Press", "beginner", "strength", "machine", "compound", ["quadriceps"], ["glutes"]),
  ex("Seated_Cable_Rows", "beginner", "strength", "cable", "compound", ["middle back"], ["biceps"]),
  ex("Lat_Pulldown", "beginner", "strength", "cable", "compound", ["lats"], ["biceps"]),
  ex("Plank", "beginner", "strength", "body only", "isolation", ["abdominals"]),
  ex("Dead_Bug", "beginner", "strength", "body only", "isolation", ["abdominals"]),
  ex("Machine_Chest_Press", "beginner", "strength", "machine", "compound", ["chest"], ["triceps"]),
  ex("Glute_Kickback", "beginner", "strength", "cable", "isolation", ["glutes"]),
  ex("Hip_Thrust_Expert", "expert", "strength", "barbell", "compound", ["glutes"]),
  ex("Barbell_Hack_Squat", "intermediate", "strength", "barbell", "compound", ["quadriceps"]),
  ex("Box_Jump", "beginner", "plyometrics", "body only", "compound", ["quadriceps"]),
];

// Bag of words hashed into 384 dimensions: texts that share words are close.
function fakeVector(text: string): number[] {
  const v = new Array<number>(384).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 7;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 384]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

describe("plans with the exercise library", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let db: Db;
  let close: () => Promise<void>;
  const llmCalls: GenerateJsonInput[] = [];
  let llm: PlannerDeps["llm"] = null;
  const deps: PlannerDeps = {
    get llm() {
      return llm;
    },
    embed: async (text) => fakeVector(text),
    now: () => MONDAY,
  };

  beforeAll(async () => {
    const created = await createTestDb();
    db = created.db;
    close = created.close;
    t = await setup({ db, close, planner: deps });
    await loadSpecs(db, path.join(ROOT, "specs/exercises"));
    const notes = ["knee", "shoulder"].flatMap((part) =>
      rag.noteChunks(
        rag.parseNote(
          `${part}.md`,
          readFileSync(path.join(ROOT, "rag/notes", `${part}.md`), "utf8").replace(/\r\n/g, "\n"),
        ),
      ),
    );
    const chunks = [
      ...LIBRARY.map((e) => rag.exerciseChunk(e as Parameters<typeof rag.exerciseChunk>[0])),
      ...notes,
    ];
    await rag.ingest(created.client, async (texts) => texts.map(fakeVector), chunks);
  });
  afterAll(() => close());

  it("retrieves library exercises with the injury filter, cites their chunks and adds them to the library", async () => {
    await profile(t, "l-knee", { experience_level: "intermediate", goals: ["strength", "core", "back"] });
    const me = await t.as("l-knee");
    await me.post("/me/injuries", { body_part: "knee", severity: "mild" });
    const plan = (await me.post("/plans/generate")).body as Plan;
    expect(plan.source).toBe("rules");
    const library = allItems(plan).filter((i) => !i.exercise.tracked);
    expect(library.length).toBeGreaterThan(0);

    // Nothing from the library that loads the knee, nothing above the user's level, no plyometrics.
    for (const id of [
      "Dumbbell_Lunges",
      "Leg_Press",
      "Barbell_Hack_Squat",
      "Box_Jump",
      "Hip_Thrust_Expert",
      "Bodyweight_Squat",
    ]) {
      expect(ids(plan)).not.toContain(id);
    }
    for (const item of library)
      expect(item.sources[0]).toEqual({
        id: `exercise:${item.exercise.id}#0`,
        title: item.exercise.id.replace(/_/g, " "),
      });
    // Adapted tracked work cites the knee note's "Limit or avoid" and "Strength swaps" sections.
    const squat = allItems(plan).find((i) => i.exercise.id === "squat" || i.exercise.id === "lunge")!;
    expect(squat.sources.map((s) => s.id)).toEqual(
      expect.arrayContaining(["injury_note:knee#0", "injury_note:knee#1"]),
    );
    expect(plan.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["injury_note:knee#0"]));

    const added = await db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.id, library[0]!.exercise.id));
    expect(added[0]).toMatchObject({ formSpec: null });
    const list = await request(t.app).get("/exercises");
    expect(list.body).toContainEqual(
      expect.objectContaining({ id: library[0]!.exercise.id, has_spec: false }),
    );
  });

  it("keeps a taste vector and ranks a liked library exercise in", async () => {
    await profile(t, "l-taste", { experience_level: "intermediate" }); // 4 a day, so there is a core slot
    const me = await t.as("l-taste");
    // Not in the exercises table yet: rating it copies it from the library.
    expect((await me.put("/me/exercise-preferences/Dead_Bug", { rating: "like" })).status).toBe(200);
    expect((await me.put("/me/exercise-preferences/Nope_Not_Real", { rating: "like" })).status).toBe(404);
    const plan = (await me.post("/plans/generate")).body as Plan;
    expect(ids(plan)).toContain("Dead_Bug");
    const [taste] = await db
      .select()
      .from(schema.exerciseTaste)
      .where(eq(schema.exerciseTaste.userId, "l-taste"));
    expect(taste).toMatchObject({ exercises: 1 });
    expect(taste!.embedding).toHaveLength(384);
  });

  it("checks gpt-oss's draft in code: unknown, oversized, disliked and badly worded items are fixed", async () => {
    await profile(t, "l-llm");
    const me = await t.as("l-llm");
    await me.put("/me/exercise-preferences/bicep_curl", { rating: "dislike" });
    llm = {
      generateJson: async <T>(input: GenerateJsonInput) => {
        llmCalls.push(input);
        const days = (input.schema.properties!.days!.items!.properties!.day!.enum ?? []) as number[];
        const data = {
          days: days.map((day) => ({
            day,
            items: [
              { exercise_id: "deadlift", sets: 3, reps: 5, reason: "Not a candidate.", sources: [] },
              {
                exercise_id: "push_up",
                sets: 9,
                reps: 40,
                reason: "Builds pressing strength for your goals.",
                sources: ["exercise:Pushups#0", "made-up"],
              },
              { exercise_id: "bicep_curl", sets: 3, reps: 10, reason: "Arms.", sources: [] },
              { exercise_id: "squat", sets: 3, reps: 10, reason: "You should always squat!", sources: [] },
            ],
          })),
        };
        return { data: data as T, model: "fake", provider: "fake", attempts: 1, latency_ms: 1, failures: [] };
      },
    };
    const plan = (await me.post("/plans/generate")).body as Plan;
    llm = null;
    expect(plan.source).toBe("llm");
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]!.user).not.toMatch(/l-llm/); // no user id goes to the model
    for (const day of plan.days) {
      const dayIds = day.items.map((i) => i.exercise.id);
      expect(dayIds).not.toContain("deadlift");
      expect(dayIds).not.toContain("bicep_curl");
      const pushUp = day.items.find((i) => i.exercise.id === "push_up")!;
      expect(pushUp).toMatchObject({ sets: 3, reps: 10, reason: "Builds pressing strength for your goals." });
      expect(pushUp.sources.map((s) => s.id)).toEqual(["exercise:Pushups#0"]);
      expect(day.items.find((i) => i.exercise.id === "squat")!.reason).toBe(
        "New this week, starting at 3 × 10.",
      );
      expect(
        day.items.some((i) => /instead of Bicep curl, which you gave a thumbs down$/.test(i.swap_note ?? "")),
      ).toBe(true);
    }
  });

  it("falls back to the rules plan when gpt-oss or the embedder fails", async () => {
    await profile(t, "l-down");
    llm = { generateJson: async () => Promise.reject(new Error("provider down")) };
    const failingEmbed = await setup({
      db,
      close: async () => {},
      planner: { llm, embed: async () => Promise.reject(new Error("embed down")), now: () => MONDAY },
    });
    const res = await request(failingEmbed.app)
      .post("/plans/generate")
      .set("Authorization", `Bearer ${await failingEmbed.keys.sign("l-down")}`);
    llm = null;
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("rules");
    expect(res.body.days).toHaveLength(3);
  });
});
