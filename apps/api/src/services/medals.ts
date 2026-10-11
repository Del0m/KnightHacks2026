// BE-05: workout medal against the lifter's own 4-week average, and personal records.
//
// Same rules as gold_workout_medals in databricks/pipelines/steadyforum_sessions/gold.py and
// pickMedal in CONN-05's score.ts, so the app, the pipeline and set scoring never disagree:
//   clean      the phone raised no rule flags for the rep (INT-06); the model only advises
//   form score = clean reps / total reps
//   gold       every rep clean (and at least one rep)
//   silver     form score >= average over the previous 28 days (70% if there is no history)
//   bronze     otherwise; finishing still counts
// Scores are compared at 4 decimal places so "matched the average" isn't lost to float error.

export type MedalTier = "bronze" | "silver" | "gold";

export const BEGINNER_BASELINE = 0.7;
export const BASELINE_WINDOW_DAYS = 28;

export function formScore(cleanReps: number, totalReps: number): number {
  return totalReps > 0 ? cleanReps / totalReps : 0;
}

export function baselineShare(previousScores: readonly number[]): number {
  if (previousScores.length === 0) return BEGINNER_BASELINE;
  return previousScores.reduce((a, b) => a + b, 0) / previousScores.length;
}

export function pickWorkoutMedal(cleanReps: number, totalReps: number, baseline: number): MedalTier {
  if (totalReps > 0 && cleanReps === totalReps) return "gold";
  const round4 = (x: number) => Math.round(x * 1e4);
  return round4(formScore(cleanReps, totalReps)) >= round4(baseline) ? "silver" : "bronze";
}

// ---- Personal records ----

export type PrMetric = "max_weight_kg" | "max_reps" | "est_1rm_kg";

export interface SetSummary {
  exerciseId: string;
  reps: number;
  weightKg: number | null;
}

export interface PrCandidate {
  exerciseId: string;
  metric: PrMetric;
  value: number;
}

export interface PrResult extends PrCandidate {
  previousValue: number | null;
}

// Epley, as in gold_user_progress_daily.
export function estimatedOneRepMax(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

// Best value per exercise and metric in this session. Weighted sets count toward weight and
// estimated 1RM; bodyweight sets (no weight) toward max reps.
export function sessionBests(sets: readonly SetSummary[]): PrCandidate[] {
  const best = new Map<string, PrCandidate>();
  const offer = (exerciseId: string, metric: PrMetric, value: number) => {
    if (!(value > 0)) return;
    const key = `${exerciseId}\u0000${metric}`;
    const current = best.get(key);
    if (!current || value > current.value) best.set(key, { exerciseId, metric, value });
  };
  for (const s of sets) {
    if (s.reps <= 0) continue;
    if (s.weightKg && s.weightKg > 0) {
      offer(s.exerciseId, "max_weight_kg", s.weightKg);
      offer(s.exerciseId, "est_1rm_kg", round2(estimatedOneRepMax(s.weightKg, s.reps)));
    } else {
      offer(s.exerciseId, "max_reps", s.reps);
    }
  }
  return [...best.values()];
}

// A first value counts as a PR, as in gold.py (`est_1rm > coalesce(previous max, 0)`).
export function detectPrs(
  candidates: readonly PrCandidate[],
  previousBest: (exerciseId: string, metric: PrMetric) => number | null,
): PrResult[] {
  return candidates.flatMap((c) => {
    const previousValue = previousBest(c.exerciseId, c.metric);
    return previousValue === null || c.value > previousValue ? [{ ...c, previousValue }] : [];
  });
}

const round2 = (x: number) => Math.round(x * 100) / 100;
