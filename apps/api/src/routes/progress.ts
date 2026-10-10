// BE-13: progress charts and risk insights, read only from Neon (§11.3: the app never waits
// on a Databricks warehouse). risk_insights is filled by the gold-table sync (CONN-06).
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { parse, send, userId } from "../http.js";

const { sessions, sets, medals, personalRecords, riskInsights } = schema;

export const INSIGHTS_DISCLAIMER =
  "This is a training-load and form-trend score, not a diagnosis. If something hurts, check with a physio.";

export function riskLevel(score: number): "low" | "moderate" | "high" {
  if (score >= 0.5) return "high"; // gold.py weak_label threshold
  if (score >= 0.25) return "moderate";
  return "low";
}

export function progressRouter(db: Db): Router {
  const router = Router();

  router.get("/me/progress", async (req, res) => {
    const me = userId(req);
    const { days } = parse(
      z.object({ days: z.coerce.number().int().min(7).max(365).default(42) }),
      req.query,
    );
    const since = new Date(Date.now() - days * 86_400_000);
    const finishedSince = and(
      eq(sessions.userId, me),
      isNotNull(sessions.finishedAt),
      gte(sessions.finishedAt, since),
    );
    const day = sql<string>`to_char(${sessions.finishedAt} at time zone 'UTC', 'YYYY-MM-DD')`;

    const [daily, trend, medalCounts, records] = await Promise.all([
      db
        .select({
          day,
          sessions: sql<number>`count(distinct ${sessions.id})::int`,
          sets: sql<number>`count(${sets.id})::int`,
          reps: sql<number>`coalesce(sum(${sets.reps}), 0)::int`,
          volumeKg: sql<number>`coalesce(sum(${sets.reps} * coalesce(${sets.weightKg}, 0)), 0)::float`,
        })
        .from(sessions)
        .leftJoin(sets, eq(sets.sessionId, sessions.id))
        .where(finishedSince)
        .groupBy(day)
        .orderBy(day),
      db
        .select({
          sessionId: sessions.id,
          finishedAt: sessions.finishedAt,
          formScore: sessions.formScore,
          medal: sessions.medal,
        })
        .from(sessions)
        .where(finishedSince)
        .orderBy(sessions.finishedAt),
      db
        .select({ tier: medals.tier, count: sql<number>`count(*)::int` })
        .from(medals)
        .where(and(eq(medals.userId, me), gte(medals.awardedAt, since)))
        .groupBy(medals.tier),
      // Current best per exercise and metric, all time.
      db
        .selectDistinctOn([personalRecords.exerciseId, personalRecords.metric], {
          exerciseId: personalRecords.exerciseId,
          metric: personalRecords.metric,
          value: personalRecords.value,
          achievedAt: personalRecords.achievedAt,
        })
        .from(personalRecords)
        .where(eq(personalRecords.userId, me))
        .orderBy(personalRecords.exerciseId, personalRecords.metric, desc(personalRecords.value)),
    ]);

    const tiers = { bronze: 0, silver: 0, gold: 0 };
    for (const m of medalCounts) tiers[m.tier] = m.count;

    send(res, {
      days,
      daily,
      formTrend: trend,
      medals: tiers,
      personalRecords: records,
    });
  });

  router.get("/me/insights", async (req, res) => {
    const me = userId(req);
    // Latest sync per body part.
    const rows = await db
      .selectDistinctOn([riskInsights.bodyPart], {
        bodyPart: riskInsights.bodyPart,
        score: riskInsights.score,
        explanation: riskInsights.explanation,
        topFeatures: riskInsights.topFeatures,
        asOf: riskInsights.asOf,
      })
      .from(riskInsights)
      .where(eq(riskInsights.userId, me))
      .orderBy(riskInsights.bodyPart, desc(riskInsights.asOf));

    send(res, {
      disclaimer: INSIGHTS_DISCLAIMER,
      insights: rows.map((r) => ({ ...r, level: riskLevel(r.score) })).sort((a, b) => b.score - a.score),
    });
  });

  return router;
}
