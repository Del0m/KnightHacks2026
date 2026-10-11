// DB-10: npm run db:seed:demo resets and reseeds the Neon `demo` branch so every screen looks
// alive during judging: ~30 lifters at 2 gyms, 6 weeks of sessions with medals and PRs, posts,
// comments, kudos, follows, goals, buddy matches and risk insights.
//
// Everything is synthetic and deterministic (seeded RNG); no real people's data. Medals and PRs
// use the same functions as the API (services/medals.ts), so the seeded history follows the
// real rules. Rows are built in memory and bulk-inserted, which keeps it fast over the network.
//
// Safety: it only reads DEMO_DATABASE_URL, never DATABASE_URL, so it can't wipe your dev branch.
// Set DEMO_PRESENTER_USER_ID to your Neon Auth user id to seed the presenter's own account too.
import seedUserIds from "../../../data/demo-user-ids.json";
import { pseudonymize } from "../src/integrations/databricks/upload.js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { createNeonDb, schema, type Db } from "../src/db.js";
import { scorePair, type MatchCandidate, type MatchProfile } from "../src/services/matching.js";
import {
  BASELINE_WINDOW_DAYS,
  baselineShare,
  detectPrs,
  pickWorkoutMedal,
  sessionBests,
  type MedalTier,
  type PrMetric,
} from "../src/services/medals.js";
import { medalPostBody, prPostBody } from "../src/services/sessions.js";

type Insert<T extends PgTable> = T["$inferInsert"];

const DAY = 86_400_000;
const WEEKS = 6;

const GYMS = [
  { placeId: "demo-gym-ucf-rwc", name: "UCF Recreation & Wellness Center", lat: 28.6024, lng: -81.2001 },
  { placeId: "demo-gym-downtown", name: "Downtown Orlando Fitness", lat: 28.5421, lng: -81.379 },
];

const MVP_EXERCISES = [
  {
    id: "squat",
    name: "Squat",
    muscles: ["quads", "glutes"],
    weighted: true,
    start: [20, 50],
    rules: ["depth", "knee_tracking", "trunk_lean", "tempo"],
  },
  {
    id: "push_up",
    name: "Push-up",
    muscles: ["chest", "triceps"],
    weighted: false,
    start: [5, 15],
    rules: ["depth", "hip_sag"],
  },
  {
    id: "bicep_curl",
    name: "Bicep Curl",
    muscles: ["biceps"],
    weighted: true,
    start: [6, 14],
    rules: ["elbow_drift", "tempo"],
  },
  {
    id: "shoulder_press",
    name: "Shoulder Press",
    muscles: ["shoulders"],
    weighted: true,
    start: [8, 20],
    rules: ["lockout", "back_arch"],
  },
  {
    id: "lunge",
    name: "Lunge",
    muscles: ["quads", "glutes"],
    weighted: true,
    start: [0, 16],
    rules: ["depth", "knee_tracking"],
  },
] as const;

const FIRST = [
  "Alex",
  "Bri",
  "Cam",
  "Dani",
  "Eli",
  "Fran",
  "Gabe",
  "Hana",
  "Ira",
  "Jo",
  "Kai",
  "Lena",
  "Max",
  "Nia",
  "Omar",
  "Pia",
  "Quinn",
  "Rae",
  "Sol",
  "Tess",
  "Uma",
  "Vic",
  "Wren",
  "Xavi",
  "Yara",
  "Zed",
  "Ari",
  "Bo",
  "Cleo",
  "Dev",
];
const STYLE = [
  "steady",
  "quiet",
  "early",
  "patient",
  "comeback",
  "first_time",
  "careful",
  "consistent",
  "slow_tempo",
  "fresh",
];
const NOUN = ["squatter", "lifter", "presser", "lunger", "helper", "starter", "mover", "grinder"];
const GOAL_TAGS = ["strength", "consistency", "mobility", "confidence", "rehab", "endurance", "form"];
const SLOTS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].flatMap((d) =>
  ["am", "pm", "eve"].map((p) => `${d}_${p}`),
);
const COMMENTS = [
  "Nice work!",
  "Steady progress 👏",
  "That tempo is paying off",
  "Same time Thursday?",
  "Love to see it",
  "Gold looks good on you",
  "Showing up is the hard part. Well done.",
  "Inspiring, thanks for sharing",
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  now?: Date;
  seed?: number;
  users?: number;
  presenterUserId?: string;
  pseudonymSecret?: string;
}

export interface SeedSummary {
  users: number;
  sessions: number;
  sets: number;
  reps: number;
  medals: Record<MedalTier, number>;
  personalRecords: number;
  posts: number;
  comments: number;
  kudos: number;
  follows: number;
  buddyMatches: number;
  rehabPlans: number;
  romTrendWeeks: number;
}

export async function seedDemo(db: Db, options: SeedOptions = {}): Promise<SeedSummary> {
  const rand = mulberry32(options.seed ?? 20261010);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const sample = <T>(xs: readonly T[], n: number): T[] => [...xs].sort(() => rand() - 0.5).slice(0, n);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - WEEKS * 7 * DAY);
  const userCount = options.users ?? seedUserIds.length;
  if (!Number.isInteger(userCount) || userCount < 1 || userCount > seedUserIds.length)
    throw new Error(`users must be between 1 and ${seedUserIds.length}`);

  if (options.presenterUserId && seedUserIds.slice(1, userCount).includes(options.presenterUserId)) {
    throw new Error("Presenter id duplicates another demo user");
  }

  // ---- Lifters ----
  const users: Insert<typeof schema.users>[] = [];
  const profiles: Insert<typeof schema.profiles>[] = [];
  const injuries: Insert<typeof schema.injuries>[] = [];
  const lifters: {
    id: string;
    gym: (typeof GYMS)[number];
    level: "beginner" | "intermediate" | "advanced";
    injury: "knee" | "shoulder" | "lower_back" | null;
    injuryId: string | null;
    side: "left" | "right" | "n/a";
    perWeek: number;
    skill: number; // starting clean-rep probability; rises over the 6 weeks
    autoPost: boolean;
    match: MatchProfile;
  }[] = [];

  for (let i = 0; i < userCount; i++) {
    const id = i === 0 && options.presenterUserId ? options.presenterUserId : seedUserIds[i]!;
    const gym = GYMS[i % GYMS.length]!;
    const r = rand();
    const level = r < 0.6 ? "beginner" : r < 0.9 ? "intermediate" : "advanced";
    // The first lifter (the presenter's account) is the §17 recovery story: a left knee.
    const injury =
      i === 0 ? "knee" : rand() < 0.25 ? pick(["knee", "shoulder", "lower_back"] as const) : null;
    const side = i === 0 ? "left" : injury === "lower_back" ? "n/a" : pick(["left", "right"] as const);
    const injuryId = injury ? randomUUID() : null;
    const handle = `${pick(STYLE)}_${pick(NOUN)}_${i + 1}`;
    const schedule = sample(
      SLOTS.filter((s) => !s.endsWith("pm") || rand() < 0.5),
      int(2, 4),
    ).sort();
    const goals = sample(injury ? ["rehab", ...GOAL_TAGS] : GOAL_TAGS, int(1, 3));
    const autoPost = i === 0 || rand() < 0.6;

    users.push({
      id,
      handle,
      pseudonym: options.pseudonymSecret ? pseudonymize(id, options.pseudonymSecret) : null,
    });
    profiles.push({
      userId: id,
      displayName: `${FIRST[i % FIRST.length]} ${String.fromCharCode(65 + (i % 26))}.`,
      experienceLevel: level,
      gymPlaceId: gym.placeId,
      gymName: gym.name,
      gymLat: gym.lat,
      gymLng: gym.lng,
      schedule,
      goals,
      bio: injury ? `Coming back from a ${injury.replace("_", " ")} injury, one quiet set at a time.` : null,
      autoPostMedals: autoPost,
      autoPostPrs: autoPost,
      shareInjuriesForMatching: injury !== null && rand() < 0.5,
    });
    if (injury) {
      injuries.push({
        id: injuryId!,
        userId: id,
        bodyPart: injury,
        side,
        severity: pick(["mild", "moderate"] as const),
        since: new Date(start.getTime() - int(14, 120) * DAY).toISOString().slice(0, 10),
        isPrivate: true,
      });
    }
    lifters.push({
      id,
      gym,
      level,
      injury,
      injuryId,
      side,
      perWeek: level === "beginner" ? int(2, 3) : int(3, 4),
      skill:
        level === "beginner"
          ? between(0.55, 0.75)
          : level === "intermediate"
            ? between(0.7, 0.85)
            : between(0.82, 0.92),
      autoPost,
      match: {
        userId: id,
        handle,
        displayName: null,
        experienceLevel: level,
        gymPlaceId: gym.placeId,
        gymName: gym.name,
        schedule,
        goals,
        weeklySessions: 0,
      },
    });
  }

  // ---- Sessions, sets, reps, flags, medals, PRs ----
  const sessions: Insert<typeof schema.sessions>[] = [];
  const sets: Insert<typeof schema.sets>[] = [];
  const reps: Insert<typeof schema.reps>[] = [];
  const flags: Insert<typeof schema.formFlags>[] = [];
  const medals: Insert<typeof schema.medals>[] = [];
  const prs: Insert<typeof schema.personalRecords>[] = [];
  const posts: Insert<typeof schema.posts>[] = [];
  const medalCounts: Record<MedalTier, number> = { bronze: 0, silver: 0, gold: 0 };

  for (const lifter of lifters) {
    const history: { finishedAt: number; score: number }[] = [];
    const best = new Map<string, number>();
    const weights = new Map<string, number>(
      MVP_EXERCISES.map((e) => [e.id, Math.round(between(e.start[0], e.start[1]) / 2.5) * 2.5]),
    );
    const favourites = sample(MVP_EXERCISES, int(3, 4));
    const sessionCount = lifter.perWeek * WEEKS - int(0, 3);
    lifter.match.weeklySessions = Math.min(lifter.perWeek, sessionCount / WEEKS);

    for (let n = 0; n < sessionCount; n++) {
      const progress = n / Math.max(1, sessionCount - 1);
      const dayOffset = Math.floor(((n + rand() * 0.6) / sessionCount) * WEEKS * 7);
      const startedAt = new Date(
        start.getTime() + dayOffset * DAY + int(6, 20) * 3_600_000 + int(0, 59) * 60_000,
      );
      const finishedAt = new Date(startedAt.getTime() + int(30, 60) * 60_000);
      if (finishedAt > now) continue;

      const sessionId = randomUUID();
      // A great day now and then makes gold reachable; injured lifters see more flags on their body part.
      const dayQuality =
        rand() < 0.12 ? 1 : lifter.skill + (0.95 - lifter.skill) * progress + between(-0.08, 0.05);
      let clean = 0;
      let total = 0;
      let position = 0;
      const sessionSets: { exerciseId: string; reps: number; weightKg: number | null }[] = [];

      for (const exercise of sample(favourites, int(2, 3))) {
        if (exercise.weighted)
          weights.set(exercise.id, weights.get(exercise.id)! + (rand() < 0.35 ? 2.5 : 0));
        const strain =
          (lifter.injury === "knee" && (exercise.id === "squat" || exercise.id === "lunge")) ||
          (lifter.injury === "shoulder" && (exercise.id === "shoulder_press" || exercise.id === "push_up"))
            ? 0.12
            : 0;
        for (let s = 0; s < 3; s++) {
          const setId = randomUUID();
          const repCount = exercise.weighted ? int(8, 12) : int(8, 15 + Math.round(progress * 6));
          const weightKg = exercise.weighted ? weights.get(exercise.id)! || null : null;
          let setClean = 0;
          for (let k = 0; k < repCount; k++) {
            const fatigue = (k / repCount) * 0.1;
            const isClean = dayQuality >= 1 || rand() < dayQuality - strain - fatigue;
            const repId = randomUUID();
            reps.push({
              id: repId,
              setId,
              position: k,
              tempoMs: Math.round(between(1500, 2600) - (isClean ? 0 : 500)),
              rangeDeg: Math.round(between(85, 100) + (isClean ? 0 : 15)),
              quality: Math.round((isClean ? between(0.8, 0.98) : between(0.35, 0.7)) * 100) / 100,
              clean: isClean,
            });
            if (!isClean) flags.push({ repId, ruleId: pick(exercise.rules), severity: "form" });
            setClean += isClean ? 1 : 0;
          }
          sets.push({
            id: setId,
            sessionId,
            position: position++,
            exerciseId: exercise.id,
            reps: repCount,
            weightKg,
            cleanShare: setClean / repCount,
            medal: setClean === repCount ? "gold" : setClean / repCount >= 0.7 ? "silver" : "bronze",
            scoreSource: "phone",
            createdAt: finishedAt,
          });
          sessionSets.push({ exerciseId: exercise.id, reps: repCount, weightKg });
          clean += setClean;
          total += repCount;
        }
      }

      const windowStart = finishedAt.getTime() - BASELINE_WINDOW_DAYS * DAY;
      const baseline = baselineShare(history.filter((h) => h.finishedAt >= windowStart).map((h) => h.score));
      const score = total ? clean / total : 0;
      const tier = pickWorkoutMedal(clean, total, baseline);
      history.push({ finishedAt: finishedAt.getTime(), score });
      medalCounts[tier]++;

      sessions.push({
        id: sessionId,
        userId: lifter.id,
        startedAt,
        finishedAt,
        device: pick(["iPhone 15", "iPhone 16 Pro", "iPhone 17 Pro Max", "iPhone 14"]),
        inferenceMode: "coreml",
        medal: tier,
        formScore: score,
        exportStatus: "exported",
        exportedAt: finishedAt,
      });
      medals.push({
        userId: lifter.id,
        sessionId,
        tier,
        formScore: score,
        baselineShare: baseline,
        awardedAt: finishedAt,
      });

      const newPrs = detectPrs(
        sessionBests(sessionSets),
        (e: string, m: PrMetric) => best.get(`${e}:${m}`) ?? null,
      );
      for (const pr of newPrs) {
        best.set(`${pr.exerciseId}:${pr.metric}`, pr.value);
        prs.push({ userId: lifter.id, ...pr, sessionId, achievedAt: finishedAt });
      }

      // Same opt-in auto posts as the API, skipping the very first sessions' PR flood.
      if (lifter.autoPost && (tier === "gold" || rand() < 0.15)) {
        posts.push({
          id: randomUUID(),
          authorId: lifter.id,
          kind: "medal",
          sessionId,
          body: medalPostBody(tier, clean, total),
          data: { tier, form_score: score, clean_reps: clean, total_reps: total },
          createdAt: finishedAt,
        });
      }
      if (lifter.autoPost && n >= 3) {
        for (const pr of newPrs
          .filter((p) => p.metric !== "est_1rm_kg" && p.previousValue !== null)
          .slice(0, 1)) {
          posts.push({
            id: randomUUID(),
            authorId: lifter.id,
            kind: "pr",
            sessionId,
            body: prPostBody(pr),
            data: {
              exercise_id: pr.exerciseId,
              metric: pr.metric,
              value: pr.value,
              previous_value: pr.previousValue,
            },
            createdAt: new Date(finishedAt.getTime() + 1000),
          });
        }
      }
    }
  }

  // ---- Goals ----
  const goals: Insert<typeof schema.goals>[] = lifters.map((l) => {
    const g = pick([
      { description: "3 gold workouts this month", metric: "gold_workouts", targetValue: 3 },
      { description: "Train 3 times a week for a month", metric: "sessions_per_week", targetValue: 3 },
      { description: "10 clean push-ups in one set", metric: "push_up_clean_reps", targetValue: 10 },
      { description: "Bodyweight squat to full depth, pain free", metric: null, targetValue: null },
    ]);
    return { userId: l.id, ...g, targetDate: new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10) };
  });
  for (const l of sample(lifters, Math.ceil(lifters.length / 3))) {
    const goal = goals.find((g) => g.userId === l.id)!;
    posts.push({
      id: randomUUID(),
      authorId: l.id,
      kind: "goal",
      body: `New goal: ${goal.description}`,
      data: { metric: goal.metric, target_value: goal.targetValue },
      createdAt: new Date(start.getTime() + int(1, WEEKS * 7 - 1) * DAY),
    });
  }

  // ---- Follows, kudos, comments ----
  const follows: Insert<typeof schema.follows>[] = [];
  const followers = new Map<string, string[]>();
  for (const l of lifters) {
    const sameGym = lifters.filter((o) => o.id !== l.id && o.gym === l.gym);
    const others = lifters.filter((o) => o.id !== l.id && o.gym !== l.gym);
    for (const o of [...sample(sameGym, int(3, 6)), ...sample(others, int(0, 2))]) {
      follows.push({ followerId: l.id, followeeId: o.id, createdAt: start });
      followers.set(o.id, [...(followers.get(o.id) ?? []), l.id]);
    }
  }

  const kudos: Insert<typeof schema.kudos>[] = [];
  const comments: Insert<typeof schema.comments>[] = [];
  for (const p of posts) {
    const fans = followers.get(p.authorId) ?? [];
    for (const fan of sample(fans, int(0, fans.length))) {
      kudos.push({
        postId: p.id!,
        userId: fan,
        createdAt: new Date(p.createdAt!.getTime() + int(1, 600) * 60_000),
      });
    }
    for (const fan of sample(fans, rand() < 0.5 ? int(1, 2) : 0)) {
      comments.push({
        postId: p.id!,
        authorId: fan,
        body: pick(COMMENTS),
        createdAt: new Date(p.createdAt!.getTime() + int(5, 900) * 60_000),
      });
    }
  }

  // ---- Buddy matches (same gym, scored with the real matcher) ----
  const buddyMatches: Insert<typeof schema.buddyMatches>[] = [];
  const paired = new Set<string>();
  for (const l of lifters) {
    if (rand() < 0.4) continue;
    const candidates = lifters.filter(
      (o) => o.id !== l.id && o.gym === l.gym && !paired.has([l.id, o.id].sort().join("|")),
    );
    if (!candidates.length) continue;
    const o = pick(candidates);
    paired.add([l.id, o.id].sort().join("|"));
    const candidate: MatchCandidate = { ...o.match, distanceKm: 0, goalSimilarity: null };
    const scored = scorePair(l.match, candidate);
    buddyMatches.push({
      aId: l.id,
      bId: o.id,
      score: scored.score,
      reasons: scored.reasons,
      status: pick(["accepted", "accepted", "requested", "declined"] as const),
    });
  }

  // ---- Risk insights (what the CONN-06 sync would write) ----
  const riskInsights: Insert<typeof schema.riskInsights>[] = lifters
    .filter((l) => l.injury)
    .flatMap((l) =>
      [14, 7, 0].map((daysAgo, i) => ({
        userId: l.id,
        bodyPart: l.injury!,
        score: Math.round((0.25 + i * 0.12 + between(0, 0.1)) * 100) / 100,
        explanation:
          l.injury === "knee"
            ? "Knee-tracking flags have risen over the last week compared with your 4-week average."
            : l.injury === "shoulder"
              ? "Pressing volume jumped this week compared with your usual load."
              : "Tempo sped up on hinge movements as sets went on.",
        topFeatures:
          l.injury === "knee"
            ? ["flag_rate_rising", "range_shrinking"]
            : ["acute_chronic_load", "tempo_speeding_up"],
        asOf: new Date(now.getTime() - daysAgo * DAY).toISOString().slice(0, 10),
      })),
    );

  // ---- Rehab plans (DB-12): what a physio gave the knee and shoulder lifters ----
  const rehabPlans: Insert<typeof schema.rehabPlans>[] = [];
  const rehabLimits: Insert<typeof schema.rehabLimits>[] = [];
  const PRESCRIPTIONS = {
    // Angles must be joint angles in the spec, the same check BE-15 applies.
    knee: [
      { exerciseId: "squat", angle: "knee", maxRangeDeg: 70, sets: 3, reps: 10, tempoMinMs: 2000 },
      { exerciseId: "lunge", angle: "knee", maxRangeDeg: 60, sets: 2, reps: 8, tempoMinMs: null },
    ],
    shoulder: [
      { exerciseId: "shoulder_press", angle: "elbow", maxRangeDeg: 90, sets: 3, reps: 10, tempoMinMs: 1500 },
      { exerciseId: "push_up", angle: "elbow", maxRangeDeg: 80, sets: 2, reps: 8, tempoMinMs: null },
    ],
  } as const;
  for (const l of lifters) {
    if (l.injury !== "knee" && l.injury !== "shoulder") continue;
    const planId = randomUUID();
    rehabPlans.push({
      id: planId,
      userId: l.id,
      injuryId: l.injuryId,
      fromPhysio: pick(["Riverside Physio", "UCF Sports Medicine", "Lakeside Rehab Clinic"]),
      startOn: new Date(start.getTime() + 3 * DAY).toISOString().slice(0, 10),
      reviewOn: new Date(now.getTime() + int(5, 14) * DAY).toISOString().slice(0, 10),
      status: "active",
      notes: "Stay inside the range limits; stop wherever it pinches.",
    });
    PRESCRIPTIONS[l.injury].forEach((p, position) =>
      rehabLimits.push({ ...p, rehabPlanId: planId, side: l.side === "n/a" ? "both" : l.side, position }),
    );
  }

  // ---- Range-of-motion trend (what CONN-14's sync would write into rom_trend) ----
  // Knee lifters: two flat baseline weeks, then range coming back toward the healthy side.
  // The presenter's numbers are pinned to the §17 line: up 18° in three weeks, within 5°.
  const romTrend: Insert<typeof schema.romTrend>[] = [];
  const firstMonday = mondayOf(start);
  for (const [n, l] of lifters.entries()) {
    if (l.injury !== "knee" || l.side === "n/a") continue;
    const healthy = n === 0 ? 103 : Math.round(between(105, 118));
    const base = n === 0 ? 72 : Math.round(between(62, 78));
    const weekly =
      n === 0
        ? [72, 73, 80, 86, 92, 98]
        : [0, 1, 2, 3, 4, 5].map((w) => base + Math.max(0, w - 1) * between(3, 6));
    const baseline = (weekly[0]! + weekly[1]!) / 2;
    weekly.forEach((peak, w) => {
      const week = new Date(firstMonday.getTime() + w * 7 * DAY);
      if (week > now) return;
      const peakRangeDeg = Math.min(Math.round(peak * 10) / 10, healthy);
      romTrend.push({
        userId: l.id,
        angle: "knee",
        side: l.side,
        week: week.toISOString().slice(0, 10),
        peakRangeDeg,
        baselineRangeDeg: baseline,
        healthySideRangeDeg: healthy,
        changeDeg: Math.round((peakRangeDeg - baseline) * 10) / 10,
      });
    });
  }

  // ---- Write ----
  await db.transaction(async (tx) => {
    // Cascades to every per-user table. The exercise library and RAG chunks are left alone.
    await tx.execute(sql`truncate table ${schema.users} cascade`);
    await tx
      .insert(schema.exercises)
      .values(MVP_EXERCISES.map((e) => ({ id: e.id, name: e.name, muscles: [...e.muscles] })))
      .onConflictDoNothing();

    const chunked = async <T extends PgTable>(table: T, rows: Insert<T>[]) => {
      for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500));
    };
    await chunked(schema.users, users);
    await chunked(schema.profiles, profiles);
    await chunked(schema.injuries, injuries);
    await chunked(schema.sessions, sessions);
    await chunked(schema.sets, sets);
    await chunked(schema.reps, reps);
    await chunked(schema.formFlags, flags);
    await chunked(schema.medals, medals);
    await chunked(schema.personalRecords, prs);
    await chunked(schema.goals, goals);
    await chunked(schema.posts, posts);
    await chunked(schema.comments, comments);
    await chunked(schema.kudos, kudos);
    await chunked(schema.follows, follows);
    await chunked(schema.buddyMatches, buddyMatches);
    await chunked(schema.riskInsights, riskInsights);
    await chunked(schema.rehabPlans, rehabPlans);
    await chunked(schema.rehabLimits, rehabLimits);
    await chunked(schema.romTrend, romTrend);
  });

  return {
    users: users.length,
    sessions: sessions.length,
    sets: sets.length,
    reps: reps.length,
    medals: medalCounts,
    personalRecords: prs.length,
    posts: posts.length,
    comments: comments.length,
    kudos: kudos.length,
    follows: follows.length,
    buddyMatches: buddyMatches.length,
    rehabPlans: rehabPlans.length,
    romTrendWeeks: romTrend.length,
  };
}

function mondayOf(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
}

async function main() {
  const url = process.env.DEMO_DATABASE_URL;
  if (!url) {
    console.error(
      "DEMO_DATABASE_URL is not set. Point it at the Neon `demo` branch (this script never uses DATABASE_URL).",
    );
    process.exit(1);
  }
  const { db, close } = createNeonDb(url);
  try {
    console.log(`Resetting and seeding ${new URL(url).host} ...`);
    const summary = await seedDemo(db, {
      presenterUserId: process.env.DEMO_PRESENTER_USER_ID || undefined,
      pseudonymSecret: process.env.STEADYFORUM_PSEUDONYM_SECRET,
    });
    console.log("Seeded:", summary);
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
