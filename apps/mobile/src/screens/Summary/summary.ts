import type { Workout } from '@/data/workout';
import type { WorkoutSet } from '@/services/workoutApi';
import type { Medal } from '@/screens/LiveSet/restCardContent';
export type PersonalRecord = { exercise_id: string; metric: 'max_reps' | 'max_weight_kg' | 'est_1rm_kg'; value: number; previous_value: number | null };
export type FinishResult = { session_id: string; medal: Medal; form_score: number; baseline_share: number; total_reps: number; clean_reps: number; personal_records: PersonalRecord[] };
export type PhoneSummary = Omit<FinishResult, 'session_id' | 'form_score'> & { form_score: number | null };
const share = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const count = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
export function readFinishResult(value: unknown): FinishResult | null {
 if (!value || typeof value !== 'object') return null;
 const r = value as FinishResult;
 if (typeof r.session_id !== 'string' || !['gold', 'silver', 'bronze'].includes(r.medal) || !share(r.form_score) || !share(r.baseline_share) || !count(r.total_reps) || !count(r.clean_reps) || r.clean_reps > r.total_reps || !Array.isArray(r.personal_records)) return null;
 if (!r.personal_records.every(p => p && typeof p.exercise_id === 'string' && ['max_reps', 'max_weight_kg', 'est_1rm_kg'].includes(p.metric) && Number.isFinite(p.value) && p.value > 0 && (p.previous_value === null || Number.isFinite(p.previous_value)))) return null;
 return { session_id: r.session_id, medal: r.medal, form_score: r.form_score, baseline_share: r.baseline_share, total_reps: r.total_reps, clean_reps: r.clean_reps, personal_records: r.personal_records };
}
export function phoneSummary(sets: WorkoutSet[], history: Workout[], now: number): PhoneSummary {
 const previous = history.filter(w => Date.parse(w.finishedAt) < now && now - Date.parse(w.finishedAt) <= 28 * 86400000).flatMap(w => {
  const details = w.details;
  if (!details?.length || details.some(s => s.goodReps === undefined) || w.reps <= 0) return [];
  return [details.reduce((n, s) => n + s.goodReps!, 0) / w.reps];
 });
 const baseline = previous.length ? previous.reduce((a, b) => a + b, 0) / previous.length : .7;
 const reps = sets.flatMap(s => s.reps), clean = reps.filter(r => r.flags.length === 0).length;
 const measured = reps.length > 0 && !reps.some(r => r.flags.some(f => f.rule_id === 'manual_unscored'));
 const score = measured ? clean / reps.length : null;
 const medal = score === 1 ? 'gold' : score !== null && Math.round(score * 10000) >= Math.round(baseline * 10000) ? 'silver' : 'bronze';
 return { medal, form_score: score, baseline_share: baseline, total_reps: reps.length, clean_reps: clean, personal_records: [] };
}
export function medalExplanation(medal: Medal) {
 return medal === 'gold' ? 'Every rep was clean.' : medal === 'silver' ? 'Your form matched or beat your 28-day average.' : 'Workout complete. Keep building your form.';
}
export const exerciseName = (id: string) => id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
