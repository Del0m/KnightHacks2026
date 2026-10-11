-- SteadyForum AI/BI dashboard (Architecture §11): one dataset per query below, all on steadyforum.gold.
-- Genie space instructions: "experience_level 'unknown' marks older synthetic sessions recorded
-- without a level; leave it out when comparing levels."
-- In Databricks: New -> Dashboard -> Data -> Create from SQL, paste one query per dataset, then
-- add the visualization named in its header on the Canvas tab.

-- @dataset kpis  (Counter tiles: sessions, lifters, reps, clean_share_pct, gold_pct)
SELECT
  count(*)                                              AS sessions,
  count(DISTINCT user_id)                               AS lifters,
  sum(total_reps)                                       AS reps,
  round(100 * sum(clean_reps) / sum(total_reps), 1)     AS clean_share_pct,
  round(100 * avg(CASE WHEN tier = 'gold' THEN 1 ELSE 0 END), 1) AS gold_pct
FROM steadyforum.gold.gold_workout_medals;

-- @dataset weekly_form  (Line chart: x = week, y = clean_share_pct; bar on secondary axis: sessions)
SELECT
  date_trunc('week', session_date)                      AS week,
  count(*)                                              AS sessions,
  round(100 * sum(clean_reps) / sum(total_reps), 1)     AS clean_share_pct
FROM steadyforum.gold.gold_workout_medals
GROUP BY 1
ORDER BY 1;

-- @dataset medals_by_week  (Stacked bar: x = week, y = workouts, color = tier)
SELECT
  date_trunc('week', session_date) AS week,
  tier,
  count(*)                         AS workouts
FROM steadyforum.gold.gold_workout_medals
GROUP BY 1, 2
ORDER BY 1, 2;

-- @dataset form_flags  (Bar: x = flag_rate_pct, y = exercise_rule, sorted descending)
SELECT
  concat(exercise_id, ' · ', rule_id)    AS exercise_rule,
  exercise_id,
  rule_id,
  sum(flagged_reps)                      AS flagged_reps,
  sum(reps)                              AS reps,
  round(100 * sum(flagged_reps) / sum(reps), 1) AS flag_rate_pct
FROM steadyforum.gold.gold_form_summary
GROUP BY 1, 2, 3
ORDER BY flag_rate_pct DESC;

-- @dataset form_flags_by_level  (Grouped bar: x = experience_level, y = flag_rate_pct, color = rule_id)
-- Older synthetic sessions have no experience level ('unknown'); they'd swamp the comparison.
SELECT
  experience_level,
  rule_id,
  sum(flagged_reps)                              AS flagged_reps,
  sum(reps)                                      AS reps,
  round(100 * sum(flagged_reps) / sum(reps), 1)  AS flag_rate_pct
FROM steadyforum.gold.gold_form_summary
WHERE experience_level <> 'unknown'
GROUP BY 1, 2
ORDER BY experience_level, flag_rate_pct DESC;

-- @dataset recovery_rom  (Line chart: x = week, y = range_deg, color = series; filter on lifter)
-- The recovery story: the injured side's weekly peak range against its baseline and the healthy side.
WITH recovering AS (
  SELECT user_id, angle, side
  FROM steadyforum.gold.gold_rom_trend
  GROUP BY user_id, angle, side
  HAVING max(change_deg) >= 10
)
SELECT
  concat('lifter ', substr(t.user_id, 1, 6), ' · ', t.side, ' ', t.angle) AS lifter,
  t.week,
  s.series,
  s.range_deg
FROM steadyforum.gold.gold_rom_trend t
JOIN recovering r USING (user_id, angle, side)
LATERAL VIEW stack(3,
  'injured side', t.peak_range_deg,
  'baseline',     t.baseline_range_deg,
  'healthy side', t.healthy_side_range_deg
) s AS series, range_deg
WHERE s.range_deg IS NOT NULL
ORDER BY lifter, t.week, s.series;

-- @dataset risk_by_body_part  (Line chart: x = week, y = avg_risk, color = body_part)
SELECT
  date_trunc('week', date)        AS week,
  body_part,
  round(avg(score), 3)            AS avg_risk,
  count(DISTINCT user_id)         AS lifters
FROM steadyforum.gold.gold_injury_risk_scores
WHERE score IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- @dataset risk_drivers  (Bar: x = lifters, y = feature) — why risk rises; a trend, not a diagnosis
-- Synthetic scores top out near 0.46, so "elevated" here is the top 10% (score >= 0.15).
SELECT
  feature,
  count(DISTINCT user_id) AS lifters,
  count(*)                AS scored_days
FROM steadyforum.gold.gold_injury_risk_scores
LATERAL VIEW explode(top_features) f AS feature
WHERE score >= 0.15
GROUP BY feature
ORDER BY lifters DESC;

-- @dataset volume_by_exercise  (Stacked area: x = week, y = reps, color = exercise_id)
SELECT
  date_trunc('week', session_date) AS week,
  exercise_id,
  sum(reps)                        AS reps,
  sum(clean_reps)                  AS clean_reps,
  sum(CASE WHEN is_pr THEN 1 ELSE 0 END) AS prs
FROM steadyforum.gold.gold_user_progress_daily
GROUP BY 1, 2
ORDER BY 1, 2;
