export type ExerciseId = 'curl' | 'squat' | 'press';
export const exercises = [
  { id: 'curl' as const, name: 'Bicep curl', muscles: 'Biceps', sets: 3, reps: 12, equipment: 'Dumbbells' },
  { id: 'squat' as const, name: 'Squat', muscles: 'Quads · glutes', sets: 3, reps: 10, equipment: 'Bodyweight' },
  { id: 'press' as const, name: 'Shoulder press', muscles: 'Shoulders', sets: 3, reps: 10, equipment: 'Dumbbells' },
];
export type Workout = { id: string; day: string; finishedAt: string; sets: number; reps: number; minutes: number };
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
  }).slice(0, 500);
  const avatar = typeof p.avatar === 'string' && p.avatar.length <= 2800000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar) ? p.avatar : '';
  return { profile: { name: p.name.slice(0, 40), bio: typeof p.bio === 'string' ? p.bio.slice(0, 160) : '', avatar, days: [...new Set(p.days)], focus: p.focus as Profile['focus'], buddyTime: p.buddyTime.slice(0, 40) }, workouts };
}
