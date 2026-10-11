// AI-12: what the planner knows about the user's last six weeks (Architecture §10.1).
//
// Everything is read from Neon, so it works before Databricks is connected: sets and their clean
// share and medals, PRs, the synced range-of-motion trend, and how much of each past plan was done.
// Recent weeks count more: a set's weight halves every two weeks (HALF_LIFE_DAYS).
//
// Weeks run Monday to Sunday in the user's time zone, the same weeks plans use. A set belongs to
// the local day it reached the API, as in todaysSession (services/rehab.ts).
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { localDate, localDayBounds } from "./rehab.js";

const { sets, sessions, personalRecords, romTrend, plans, planItems } = schema;

export const HISTORY_WEEKS = 6;
export const HALF_LIFE_DAYS = 14;
export const WEEKLY_INCREASE = 0.1; // §10.1: weekly volume grows by at most 10%

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The Monday on or before a calendar date. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export const recencyWeight = (daysAgo: number) => 0.5 ** (Math.max(0, daysAgo) / HALF_LIFE_DAYS);

export interface ExerciseHistory {
  exerciseId: string;
  sessions: number; // sessions with at least one set of it
  weightedSessions: number; // the same, recency-weighted
  lastDoneDaysAgo: number | null;
  setsPerSession: number | null; // average over the last three sessions
  repsPerSet: number | null; // average over the last three sessions
  clean: number | null; // recency-weighted clean share
  cleanRecent: number | null; // last two weeks
  cleanBefore: number | null; // the four weeks before that
  medals: { gold: number; silver: number; bronze: number }; // set medals
  prs: number;
  planned: number; // times it was in a past plan in the window
  done: number; // how many of those it was trained in the plan's week
}

export interface WeekVolume {
  weekOf: string;
  sets: number;
  reps: number;
}

export interface History {
  weekOf: string;
  weeks: WeekVolume[]; // the HISTORY_WEEKS weeks before weekOf, most recent first
  baseline: WeekVolume | null; // the most recent of those with any training
  volumeCap: number | null; // reps allowed this week: baseline + 10%, rounded up
  lastPlan: { weekOf: string; items: number; done: number; adherence: number } | null;
  exercises: Map<string, ExerciseHistory>;
  rom: { angle: string; side: string; week: string; changeDeg: number }[]; // latest per angle and side
}

function emptyExercise(exerciseId: string): ExerciseHistory {
  return {
    exerciseId,
    sessions: 0,
    weightedSessions: 0,
    lastDoneDaysAgo: null,
    setsPerSession: null,
    repsPerSet: null,
    clean: null,
    cleanRecent: null,
    cleanBefore: null,
    medals: { gold: 0, silver: 0, bronze: 0 },
    prs: 0,
    planned: 0,
    done: 0,
  };
}

function weightedMean(values: [value: number, weight: number][]): number | null {
  const total = values.reduce((s, [, w]) => s + w, 0);
  return total > 0 ? values.reduce((s, [v, w]) => s + v * w, 0) / total : null;
}

export async function loadHistory(
  db: Db,
  userId: string,
  weekOf: string,
  timeZone: string,
  today: string,
): Promise<History> {
  const windowStart = addDays(weekOf, -7 * HISTORY_WEEKS);
  const from = localDayBounds(windowStart, timeZone).start;

  const [setRows, prRows, romRows, planRows] = await Promise.all([
    db
      .select({
        exerciseId: sets.exerciseId,
        sessionId: sets.sessionId,
        reps: sets.reps,
        cleanShare: sets.cleanShare,
        medal: sets.medal,
        at: sets.createdAt,
      })
      .from(sets)
      .innerJoin(sessions, eq(sessions.id, sets.sessionId))
      .where(and(eq(sessions.userId, userId), gte(sets.createdAt, from)))
      .orderBy(desc(sets.createdAt)),
    db
      .select({ exerciseId: personalRecords.exerciseId })
      .from(personalRecords)
      .where(and(eq(personalRecords.userId, userId), gte(personalRecords.achievedAt, from))),
    db
      .select()
      .from(romTrend)
      .where(and(eq(romTrend.userId, userId), gte(romTrend.week, windowStart)))
      .orderBy(desc(romTrend.week)),
    db
      .select({ id: plans.id, weekOf: plans.weekOf })
      .from(plans)
      .where(and(eq(plans.userId, userId), gte(plans.weekOf, windowStart), lt(plans.weekOf, weekOf)))
      .orderBy(desc(plans.weekOf), desc(plans.createdAt)),
  ]);

  const exercises = new Map<string, ExerciseHistory>();
  const of = (id: string) => {
    let h = exercises.get(id);
    if (!h) exercises.set(id, (h = emptyExercise(id)));
    return h;
  };

  // Weekly volume before this week, and which local days each exercise was trained on.
  const weeks: WeekVolume[] = Array.from({ length: HISTORY_WEEKS }, (_, i) => ({
    weekOf: addDays(weekOf, -7 * (i + 1)),
    sets: 0,
    reps: 0,
  }));
  const trainedDays = new Map<string, Set<string>>(); // exercise -> local dates
  const bySession = new Map<string, Map<string, { sets: number; reps: number }>>(); // exercise -> session
  const clean = new Map<
    string,
    { all: [number, number][]; recent: [number, number][]; before: [number, number][] }
  >();

  for (const row of setRows) {
    const day = localDate(row.at, timeZone);
    const daysAgo = daysBetween(day, today);
    const week = weeks.find((w) => w.weekOf === mondayOf(day));
    if (week) {
      week.sets += 1;
      week.reps += row.reps;
    }
    const h = of(row.exerciseId);
    if (h.lastDoneDaysAgo === null || daysAgo < h.lastDoneDaysAgo) h.lastDoneDaysAgo = daysAgo;
    if (row.medal) h.medals[row.medal] += 1;

    let days = trainedDays.get(row.exerciseId);
    if (!days) trainedDays.set(row.exerciseId, (days = new Set()));
    days.add(day);

    let perSession = bySession.get(row.exerciseId);
    if (!perSession) bySession.set(row.exerciseId, (perSession = new Map()));
    const s = perSession.get(row.sessionId);
    if (s) {
      s.sets += 1;
      s.reps += row.reps;
    } else {
      perSession.set(row.sessionId, { sets: 1, reps: row.reps });
      h.sessions += 1;
      h.weightedSessions += recencyWeight(daysAgo);
    }

    if (row.cleanShare !== null) {
      let c = clean.get(row.exerciseId);
      if (!c) clean.set(row.exerciseId, (c = { all: [], recent: [], before: [] }));
      c.all.push([row.cleanShare, recencyWeight(daysAgo)]);
      (daysAgo < 14 ? c.recent : c.before).push([row.cleanShare, 1]);
    }
  }

  for (const [id, perSession] of bySession) {
    // Rows came newest first, so the map's first entries are the latest sessions.
    const last = [...perSession.values()].slice(0, 3);
    const h = of(id);
    h.setsPerSession = last.reduce((s, x) => s + x.sets, 0) / last.length;
    h.repsPerSet = last.reduce((s, x) => s + x.reps, 0) / last.reduce((s, x) => s + x.sets, 0);
  }
  for (const [id, c] of clean) {
    const h = of(id);
    h.clean = weightedMean(c.all);
    h.cleanRecent = weightedMean(c.recent);
    h.cleanBefore = weightedMean(c.before);
  }
  for (const pr of prRows) of(pr.exerciseId).prs += 1;

  // Past plans: the newest plan of each week is the one the user was following.
  const followed = new Map<string, string>(); // weekOf -> plan id
  for (const p of planRows) if (!followed.has(p.weekOf)) followed.set(p.weekOf, p.id);
  const items = followed.size
    ? await db
        .select({ planId: planItems.planId, exerciseId: planItems.exerciseId, day: planItems.day })
        .from(planItems)
        .where(inArray(planItems.planId, [...followed.values()]))
    : [];
  let lastPlan: History["lastPlan"] = null;
  for (const [planWeek, planId] of followed) {
    const planned = new Map<string, number>(); // exercise -> times planned that week
    for (const item of items) {
      if (item.planId === planId) planned.set(item.exerciseId, (planned.get(item.exerciseId) ?? 0) + 1);
    }
    let total = 0;
    let done = 0;
    for (const [exerciseId, times] of planned) {
      // Planned three times and trained on two days of that week: two of three done.
      const daysTrained = [...(trainedDays.get(exerciseId) ?? [])].filter(
        (d) => mondayOf(d) === planWeek,
      ).length;
      const h = of(exerciseId);
      h.planned += times;
      h.done += Math.min(times, daysTrained);
      total += times;
      done += Math.min(times, daysTrained);
    }
    if (!lastPlan && total > 0) lastPlan = { weekOf: planWeek, items: total, done, adherence: done / total };
  }

  const rom: History["rom"] = [];
  for (const r of romRows) {
    if (r.changeDeg === null || rom.some((x) => x.angle === r.angle && x.side === r.side)) continue;
    rom.push({ angle: r.angle, side: r.side, week: r.week, changeDeg: r.changeDeg });
  }

  const baseline = weeks.find((w) => w.sets > 0) ?? null;
  return {
    weekOf,
    weeks,
    baseline,
    volumeCap: baseline ? Math.ceil(baseline.reps * (1 + WEEKLY_INCREASE)) : null,
    lastPlan,
    exercises,
    rom,
  };
}

/** The summary stored on the plan (plans.history), so "why" questions can be answered later. */
export function historySummary(h: History) {
  return {
    windowWeeks: HISTORY_WEEKS,
    halfLifeDays: HALF_LIFE_DAYS,
    weeklyReps: h.weeks.map((w) => ({ weekOf: w.weekOf, sets: w.sets, reps: w.reps })),
    baselineWeekOf: h.baseline?.weekOf ?? null,
    baselineReps: h.baseline?.reps ?? null,
    volumeCap: h.volumeCap,
    lastPlanAdherence: h.lastPlan ? Math.round(h.lastPlan.adherence * 100) / 100 : null,
    exercisesSeen: h.exercises.size,
  };
}
