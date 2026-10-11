// BE-16: range-of-motion trend and the one-page physio report (Architecture §1.1, §13).
//
// Everything is read from Neon (§11.3): rom_trend is the Databricks gold table synced by CONN-14,
// sessions and flags are the API's own. Nothing is sent anywhere: the report is shown to the user,
// and only reaches a physio through a share link the user creates (and can revoke).
//
// physio_limit flags are AI-16's generated safety rule. Until the phone applies physio limits the
// count is simply 0; the rule id is the contract (AI-16 issue, form-rules design).
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { notFound } from "../http.js";
import { addDays, daysBetween, mondayOf } from "./planHistory.js";
import { localDate, localDayBounds } from "./rehab.js";

const {
  romTrend,
  rehabPlans,
  rehabLimits,
  exercises,
  sessions,
  sets,
  reps,
  formFlags,
  profiles,
  reportShares,
} = schema;

export const REPORT_DISCLAIMER =
  "SteadyForum is a fitness app, not a medical one. It records what your physio prescribed and does not give treatment advice.";
export const MEASURED_HOW =
  "Range of motion comes from the phone camera's pose tracking; no video is stored. Each week's figure is " +
  "the peak range of that week's reps (90th percentile), in degrees of bend from straight. Sessions and " +
  "reps past the prescribed limits come from the workouts recorded in SteadyForum.";
export const PHYSIO_LIMIT_RULE = "physio_limit";
export const SHARE_DAYS_DEFAULT = 14;
export const MAX_REPORT_DAYS = 26 * 7;

// ---- Range-of-motion trend ----

export interface RomWeek {
  week: string; // Monday
  left: number | null;
  right: number | null;
}

export interface RomTrend {
  angle: string;
  injuredSide: "left" | "right" | null;
  weeks: RomWeek[];
  latest: { week: string; injured: number | null; healthy: number | null; gap: number | null } | null;
  summary: string;
}

const round = (n: number) => Math.round(n);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "knee range up 18° in 3 weeks, now within 5° of the healthy side" */
export function romSummary(
  angle: string,
  points: { week: string; peak: number }[],
  healthy: number | null,
): string {
  if (!points.length) return `No range-of-motion data for the ${angle} yet.`;
  const first = points[0]!;
  const last = points.at(-1)!;
  const change = round(last.peak - first.peak);
  const weeks = Math.round(daysBetween(first.week, last.week) / 7);
  let text: string;
  if (points.length === 1 || weeks === 0) text = `${angle} range ${round(last.peak)}° this week`;
  else if (Math.abs(change) < 1)
    text = `${angle} range steady at ${round(last.peak)}° over ${plural(weeks, "week")}`;
  else text = `${angle} range ${change > 0 ? "up" : "down"} ${Math.abs(change)}° in ${plural(weeks, "week")}`;
  if (healthy !== null) {
    const gap = round(healthy - last.peak);
    if (Math.abs(gap) < 1) text += ", level with the healthy side";
    else if (gap > 0 && gap <= 5) text += `, now within ${gap}° of the healthy side`;
    else if (gap > 0) text += `, ${gap}° short of the healthy side`;
    else text += `, ${-gap}° past the healthy side`;
  }
  return text;
}

export async function romTrendFor(
  db: Db,
  userId: string,
  angle: string,
  from: string,
  to: string,
): Promise<RomTrend> {
  const rows = await db
    .select()
    .from(romTrend)
    .where(
      and(
        eq(romTrend.userId, userId),
        eq(romTrend.angle, angle),
        gte(romTrend.week, mondayOf(from)),
        lt(romTrend.week, addDays(to, 1)),
      ),
    )
    .orderBy(asc(romTrend.week));

  // The injured side is the one the pipeline compared with the other (healthy_side_range_deg set).
  const compared = [...rows].reverse().find((r) => r.healthySideRangeDeg !== null);
  const injuredSide = compared ? (compared.side as "left" | "right") : null;

  const byWeek = new Map<string, RomWeek>();
  for (const r of rows) {
    const w = byWeek.get(r.week) ?? { week: r.week, left: null, right: null };
    if (r.side === "left" || r.side === "right") w[r.side] = Math.round(r.peakRangeDeg * 10) / 10;
    byWeek.set(r.week, w);
  }
  const weeks = [...byWeek.values()];

  const side = injuredSide ?? (rows.some((r) => r.side === "left") ? "left" : "right");
  const points = rows.filter((r) => r.side === side).map((r) => ({ week: r.week, peak: r.peakRangeDeg }));
  const lastRow = [...rows].reverse().find((r) => r.side === side);
  const healthy = injuredSide && lastRow ? lastRow.healthySideRangeDeg : null;
  return {
    angle,
    injuredSide,
    weeks,
    latest: lastRow
      ? {
          week: lastRow.week,
          injured: injuredSide ? lastRow.peakRangeDeg : null,
          healthy,
          gap: healthy !== null ? Math.round((healthy - lastRow.peakRangeDeg) * 10) / 10 : null,
        }
      : null,
    summary: romSummary(angle, points, healthy),
  };
}

// ---- Report ----

export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

/**
 * The plan the report is about: a given one (a share link's), else the active one, else the most
 * recent. Always the user's own.
 */
export async function reportPlan(db: Db, userId: string, planId?: string) {
  if (planId) {
    const [plan] = await db
      .select()
      .from(rehabPlans)
      .where(and(eq(rehabPlans.id, planId), eq(rehabPlans.userId, userId)));
    return plan ?? null;
  }
  const [active] = await db
    .select()
    .from(rehabPlans)
    .where(and(eq(rehabPlans.userId, userId), eq(rehabPlans.status, "active")));
  if (active) return active;
  const [latest] = await db
    .select()
    .from(rehabPlans)
    .where(eq(rehabPlans.userId, userId))
    .orderBy(desc(rehabPlans.startOn), desc(rehabPlans.createdAt))
    .limit(1);
  return latest ?? null;
}

/** Default range: the plan's start (at most 26 weeks back) to today. */
export async function defaultRange(
  db: Db,
  userId: string,
  today: string,
  timeZone: string,
): Promise<ReportRange> {
  const plan = await reportPlan(db, userId);
  if (!plan) throw notFound("Rehab plan");
  const earliest = addDays(today, -(MAX_REPORT_DAYS - 1));
  const from = plan.startOn > today ? today : plan.startOn < earliest ? earliest : plan.startOn;
  return { from, to: today, timeZone };
}

export async function physioReport(
  db: Db,
  userId: string,
  range: ReportRange,
  today: string,
  planId?: string,
) {
  const plan = await reportPlan(db, userId, planId);
  if (!plan) throw notFound("Rehab plan");
  const { from, to, timeZone } = range;
  const start = localDayBounds(from, timeZone).start;
  const end = localDayBounds(to, timeZone).end;

  const [profile] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const limits = await db
    .select({
      exerciseId: rehabLimits.exerciseId,
      name: exercises.name,
      angle: rehabLimits.angle,
      side: rehabLimits.side,
      maxRangeDeg: rehabLimits.maxRangeDeg,
      sets: rehabLimits.sets,
      reps: rehabLimits.reps,
    })
    .from(rehabLimits)
    .innerJoin(exercises, eq(exercises.id, rehabLimits.exerciseId))
    .where(eq(rehabLimits.rehabPlanId, plan.id))
    .orderBy(asc(rehabLimits.position), asc(rehabLimits.createdAt));
  const exerciseIds = [...new Set(limits.map((l) => l.exerciseId))];

  // Sets of the prescribed exercises in the range, wherever they were done (as todaysSession).
  const done = exerciseIds.length
    ? await db
        .select({ exerciseId: sets.exerciseId, at: sets.createdAt })
        .from(sets)
        .innerJoin(sessions, eq(sessions.id, sets.sessionId))
        .where(
          and(
            eq(sessions.userId, userId),
            inArray(sets.exerciseId, exerciseIds),
            gte(sets.createdAt, start),
            lt(sets.createdAt, end),
          ),
        )
    : [];
  const flags = await db
    .select({ exerciseId: sets.exerciseId, n: sql<number>`count(*)::int` })
    .from(formFlags)
    .innerJoin(reps, eq(reps.id, formFlags.repId))
    .innerJoin(sets, eq(sets.id, reps.setId))
    .innerJoin(sessions, eq(sessions.id, sets.sessionId))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(formFlags.ruleId, PHYSIO_LIMIT_RULE),
        gte(sets.createdAt, start),
        lt(sets.createdAt, end),
      ),
    )
    .groupBy(sets.exerciseId);

  // The plan is a daily home programme with no frequency stored, so each day it was in force counts
  // as one prescribed session; a day with any set of a prescribed exercise counts as completed.
  const planFrom = plan.startOn > from ? plan.startOn : from;
  const lastDay = to < today ? to : today;
  const prescribed = lastDay >= planFrom ? daysBetween(planFrom, lastDay) + 1 : 0;
  const daysDone = new Set(done.map((d) => localDate(d.at, timeZone)).filter((d) => d >= planFrom));

  const angles = [...new Set(limits.map((l) => l.angle))];
  const trends = await Promise.all(angles.map((a) => romTrendFor(db, userId, a, from, to)));

  return {
    disclaimer: REPORT_DISCLAIMER,
    measuredHow: MEASURED_HOW,
    firstName: profile?.displayName?.trim().split(/\s+/)[0] || null,
    range: { from, to, timeZone },
    rehabPlan: { startOn: plan.startOn, reviewOn: plan.reviewOn, status: plan.status },
    sessions: { completed: daysDone.size, prescribed },
    exercises: exerciseIds.map((id) => {
      const mine = limits.filter((l) => l.exerciseId === id);
      return {
        exerciseId: id,
        name: mine[0]!.name,
        prescribed: mine.map((l) => ({
          angle: l.angle,
          side: l.side,
          maxRangeDeg: l.maxRangeDeg,
          sets: l.sets,
          reps: l.reps,
        })),
        setsDone: done.filter((d) => d.exerciseId === id).length,
        repsPastLimits: flags.find((f) => f.exerciseId === id)?.n ?? 0,
      };
    }),
    romTrend: trends,
    leftRight: trends.map((t) => {
      const last = t.weeks.at(-1);
      return {
        angle: t.angle,
        week: last?.week ?? null,
        left: last?.left ?? null,
        right: last?.right ?? null,
        difference:
          last && last.left !== null && last.right !== null
            ? Math.round(Math.abs(last.left - last.right) * 10) / 10
            : null,
      };
    }),
    repsPastLimits: flags.reduce((n, f) => n + f.n, 0),
  };
}

export type PhysioReport = Awaited<ReturnType<typeof physioReport>>;

// ---- Share links ----

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createShare(
  db: Db,
  userId: string,
  range: ReportRange,
  days: number,
  rehabPlanId: string,
  now = new Date(),
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("base64url"); // 192 bits, unguessable
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  const [row] = await db
    .insert(reportShares)
    .values({
      userId,
      tokenHash: hashToken(token),
      rehabPlanId,
      fromDate: range.from,
      toDate: range.to,
      timeZone: range.timeZone,
      expiresAt,
    })
    .returning({ id: reportShares.id });
  return { id: row!.id, token, expiresAt };
}

export async function listShares(db: Db, userId: string, now = new Date()) {
  const rows = await db
    .select({
      id: reportShares.id,
      fromDate: reportShares.fromDate,
      toDate: reportShares.toDate,
      expiresAt: reportShares.expiresAt,
      revokedAt: reportShares.revokedAt,
      createdAt: reportShares.createdAt,
    })
    .from(reportShares)
    .where(eq(reportShares.userId, userId))
    .orderBy(desc(reportShares.createdAt));
  return rows.map((r) => ({ ...r, active: !r.revokedAt && r.expiresAt > now }));
}

export async function revokeShare(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .update(reportShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(reportShares.id, id), eq(reportShares.userId, userId), isNull(reportShares.revokedAt)))
    .returning({ id: reportShares.id });
  if (rows.length) return;
  const [exists] = await db
    .select({ id: reportShares.id })
    .from(reportShares)
    .where(and(eq(reportShares.id, id), eq(reportShares.userId, userId)));
  if (!exists) throw notFound("Share link"); // revoking twice is fine
}

/** The share behind a token, or null if it's unknown, expired or revoked. */
export async function resolveShare(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(reportShares)
    .where(
      and(
        eq(reportShares.tokenHash, hashToken(token)),
        isNull(reportShares.revokedAt),
        gt(reportShares.expiresAt, now),
      ),
    );
  return row ?? null;
}

// ---- Printable page ----

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const deg = (n: number | null) => (n === null ? "–" : `${Math.round(n)}°`);

/** One printable page. First name and date range only: no email, handle or location (§13). */
export function reportHtml(r: PhysioReport, expiresAt: Date): string {
  const rows = (cells: string[][]) =>
    cells.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("");
  const exerciseRows = rows(
    r.exercises.map((e) => [
      escape(e.name),
      escape(
        e.prescribed
          .map(
            (p) =>
              `${p.sets} × ${p.reps}, ${p.angle} up to ${Math.round(p.maxRangeDeg)}°${p.side === "both" ? "" : ` (${p.side})`}`,
          )
          .join("; "),
      ),
      String(e.setsDone),
      String(e.repsPastLimits),
    ]),
  );
  const romSections = r.romTrend
    .map(
      (t) => `<h2>${escape(t.angle[0]!.toUpperCase() + t.angle.slice(1))} range of motion</h2>
<p class="summary">${escape(t.summary[0]!.toUpperCase() + t.summary.slice(1))}.</p>
${
  t.weeks.length
    ? `<table><thead><tr><th>Week of</th><th>Left</th><th>Right</th></tr></thead><tbody>${rows(
        t.weeks.map((w) => [escape(w.week), deg(w.left), deg(w.right)]),
      )}</tbody></table>`
    : ""
}`,
    )
    .join("\n");
  const who = r.firstName ? `${escape(r.firstName)}'s` : "Rehab";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${who} progress report</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2a33;background:#fff;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 6px}
.muted{color:#5b6b75}.disclaimer{border-left:4px solid #c9a227;background:#fbf7e9;padding:10px 12px;margin:16px 0}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border-bottom:1px solid #dfe5e8;padding:6px 8px;text-align:left}
th{font-weight:600;background:#f3f6f7}.summary{font-weight:600}
@media print{body{margin:0}.noprint{display:none}}
</style></head><body>
<h1>${who} progress report</h1>
<p class="muted">${escape(r.range.from)} to ${escape(r.range.to)} · Rehab plan started ${escape(r.rehabPlan.startOn)}</p>
<p class="disclaimer">${escape(r.disclaimer)}</p>
<h2>Sessions</h2>
<p>${r.sessions.completed} of ${r.sessions.prescribed} prescribed days had at least one set of the prescribed exercises.</p>
<table><thead><tr><th>Exercise</th><th>Prescribed</th><th>Sets done</th><th>Reps past the limits</th></tr></thead><tbody>${exerciseRows}</tbody></table>
${romSections}
<h2>Left and right</h2>
<table><thead><tr><th>Joint</th><th>Week of</th><th>Left</th><th>Right</th><th>Difference</th></tr></thead><tbody>${rows(
    r.leftRight.map((l) => [
      escape(l.angle),
      escape(l.week ?? "–"),
      deg(l.left),
      deg(l.right),
      deg(l.difference),
    ]),
  )}</tbody></table>
<h2>How this was measured</h2>
<p class="muted">${escape(r.measuredHow)}</p>
<p class="muted noprint">This link expires on ${escape(expiresAt.toISOString().slice(0, 10))}. The person who shared it can turn it off at any time.</p>
</body></html>`;
}
