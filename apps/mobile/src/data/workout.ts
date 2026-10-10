export type ExerciseId = 'curl' | 'squat' | 'press';
export const exercises = [
  { id: 'curl' as const, name: 'Bicep curl', muscles: 'Biceps', sets: 3, reps: 12, equipment: 'Dumbbells' },
  { id: 'squat' as const, name: 'Squat', muscles: 'Quads · glutes', sets: 3, reps: 10, equipment: 'Bodyweight' },
  { id: 'press' as const, name: 'Shoulder press', muscles: 'Shoulders', sets: 3, reps: 10, equipment: 'Dumbbells' },
];
export type WorkoutDetailSet = { exercise_id: string; reps: number; goodReps?: number; note?: string; medal?: 'gold' | 'silver' | 'bronze' };
export type Workout = { id: string; day: string; finishedAt: string; sets: number; reps: number; minutes: number; details?: WorkoutDetailSet[] };
export type Profile = { name: string; bio: string; avatar: string; days: number[]; focus: 'Build strength' | 'Stay consistent'; buddyTime: string };
export const initialProfile: Profile = { name: '', bio: '', avatar: '', days: [1, 3, 5], focus: 'Stay consistent', buddyTime: 'Evenings' };
export function calendarDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function streak(workouts: Workout[], now = new Date()) {
  const days = new Set(workouts.map(w => w.day));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(calendarDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(calendarDay(cursor))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return count;
}
export function streakTier(days: number) { return days < 1 ? 0 : days < 7 ? 1 : days < 30 ? 2 : days < 100 ? 3 : 4; }
export function readSaved(value: unknown): { profile: Profile; workouts: Workout[] } | null {
  if (!value || typeof value !== 'object') return null;
  const x = value as { profile?: Partial<Profile>; workouts?: unknown[] };
  const p = x.profile;
  if (!p || typeof p.name !== 'string' || !Array.isArray(p.days) || !p.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) || !['Build strength', 'Stay consistent'].includes(p.focus ?? '') || typeof p.buddyTime !== 'string' || !Array.isArray(x.workouts)) return null;
  const workouts = x.workouts.filter((w): w is Workout => {
    if (!w || typeof w !== 'object') return false;
    const row = w as Workout;
    return typeof row.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && typeof row.finishedAt === 'string' && [row.sets, row.reps, row.minutes].every(n => Number.isFinite(n) && n >= 0);
  }).slice(0, 500).map(row => ({ ...row, details: readWorkoutDetails(row.details) }));
  const avatar = typeof p.avatar === 'string' && p.avatar.length <= 2800000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar) ? p.avatar : '';
  return { profile: { name: p.name.slice(0, 40), bio: typeof p.bio === 'string' ? p.bio.slice(0, 160) : '', avatar, days: [...new Set(p.days)], focus: p.focus as Profile['focus'], buddyTime: p.buddyTime.slice(0, 40) }, workouts };
}

/** Legacy aggregate records remain valid; only measured details are displayed. */
export function readWorkoutDetails(value: unknown): WorkoutDetailSet[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: WorkoutDetailSet[] = [];
  for (const entry of value.slice(0, 500)) {
    if (!entry || typeof entry !== 'object') continue;
    const set = entry as WorkoutDetailSet;
    if (typeof set.exercise_id !== 'string' || !set.exercise_id.trim() || !Number.isInteger(set.reps) || set.reps < 0) continue;
    result.push({ exercise_id: set.exercise_id.slice(0, 100), reps: set.reps,
      ...(Number.isInteger(set.goodReps) && set.goodReps! >= 0 && set.goodReps! <= set.reps ? { goodReps: set.goodReps } : {}),
      ...(typeof set.note === 'string' ? { note: set.note.slice(0, 500) } : {}),
      ...(['gold', 'silver', 'bronze'].includes(set.medal ?? '') ? { medal: set.medal } : {}),
    });
  }
  return result.length ? result : undefined;
}
export function workoutsOnDay(workouts: Workout[], day: string) {
  return workouts.filter(workout => workout.day === day).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

/** Check an exercise only after its full prescription is completed today. */
export function completedToday(workouts: Workout[], id: string, sets: number, day = calendarDay()) {
  return workouts.filter(workout => workout.day === day).flatMap(workout => workout.details ?? []).filter(set => set.exercise_id === id).length >= sets;
}
