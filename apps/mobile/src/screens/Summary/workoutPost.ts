import type { WorkoutSet } from '@/services/workoutApi';
import { exerciseName, type PhoneSummary } from './summary';

export type PublicWorkout = { date: string; exercises: { id: string; name: string; sets: number; reps: number }[]; highlights: string[] };
export function workoutPost(records: WorkoutSet[], result: PhoneSummary, date: string, hasMeasuredHistory: boolean) {
  const exercises: PublicWorkout['exercises'] = [];
  for (const set of records) {
    let item = exercises.find(e => e.id === set.exercise_id);
    if (!item) { item = { id: set.exercise_id, name: exerciseName(set.exercise_id), sets: 0, reps: 0 }; exercises.push(item); }
    item.sets++; item.reps += set.reps.length;
  }
  const measured = records.length > 0 && result.form_score !== null && !records.some(s => s.reps.some(r => r.flags.some(f => f.rule_id === 'manual_unscored')));
  const highlights = (measured ? result.personal_records : []).filter(pr => pr.previous_value !== null && pr.value > pr.previous_value).slice(0, 3).map(pr =>
    `${exerciseName(pr.exercise_id)}: new ${pr.metric === 'max_reps' ? 'rep best' : pr.metric === 'max_weight_kg' ? 'weight best' : 'estimated strength best'} of ${pr.value}${pr.metric === 'max_reps' ? ' reps' : ' kg'}.`);
  const change = measured ? Math.round((result.form_score! - result.baseline_share) * 100) : 0;
  if (hasMeasuredHistory && change > 0) highlights.push(`Form improved by ${change} percentage points over the 28-day average.`);
  const totalReps = records.reduce((n, s) => n + s.reps.length, 0);
  if (!highlights.length) highlights.push(`Completed ${records.length} set${records.length === 1 ? '' : 's'} and ${totalReps} rep${totalReps === 1 ? '' : 's'}.`);
  return {
    body: `${result.medal[0].toUpperCase() + result.medal.slice(1)} workout${exercises.length ? ` · ${exercises.map(e => e.name).join(', ')}` : ''}.\n${highlights.join(' ')}`,
    data: { tier: result.medal, form_score: measured ? result.form_score : null, total_reps: totalReps, clean_reps: measured ? result.clean_reps : null, workout: { date, exercises, highlights } },
  };
}

/** Older posts and malformed optional summaries retain their original body. */
export function readPublicWorkout(data: Record<string, unknown> | null): PublicWorkout | null {
  const value = data?.workout as PublicWorkout | undefined;
  if (!value || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Array.isArray(value.exercises) || !value.exercises.length || value.exercises.length > 30 || !Array.isArray(value.highlights) || value.highlights.length > 10) return null;
  if (!value.exercises.every(e => e && typeof e.id === 'string' && typeof e.name === 'string' && e.name.length <= 100 && Number.isInteger(e.sets) && e.sets > 0 && Number.isInteger(e.reps) && e.reps >= 0) || !value.highlights.every(h => typeof h === 'string' && h.length <= 300)) return null;
  return value;
}
