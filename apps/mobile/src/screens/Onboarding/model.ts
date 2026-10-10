import { calendarDay } from '../../data/workout';

export const goalGroups = [
  { title: 'What you want to achieve', goals: [
    { id: 'muscle', label: 'Increase muscle' }, { id: 'weight', label: 'Lose weight' },
    { id: 'strength', label: 'Build strength' }, { id: 'endurance', label: 'Improve endurance' },
    { id: 'mobility', label: 'Improve mobility' }, { id: 'consistency', label: 'Stay consistent' },
  ] },
  { title: 'Where you want to build', goals: [
    { id: 'chest', label: 'Chest' }, { id: 'back', label: 'Back' },
    { id: 'shoulders', label: 'Shoulders' }, { id: 'arms', label: 'Arms' },
    { id: 'core', label: 'Core' }, { id: 'legs', label: 'Legs & glutes' },
  ] },
];
export const bestExercises = [{ id: 'squat', label: 'Squat' }, { id: 'bench', label: 'Bench press' }, { id: 'deadlift', label: 'Deadlift' }];
export const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export type Experience = 'beginner' | 'experienced' | 'advanced';
export type Schedule = { kind: 'weekly'; days: number[] } | { kind: 'interval'; every_days: number; start_date: string };
export type PersonalBest = { exercise: string; weight: number; unit: 'lb' | 'kg'; reps: number };
export type OnboardingProfile = { goals: string[]; experience_level: Experience; personal_bests: PersonalBest[]; schedule: Schedule; onboarding_completed: boolean; injury_note?: string };
export type Draft = {
  goals: string[]; experience: Experience | null; unknownBests: boolean; unit: 'lb' | 'kg';
  bests: { exercise: string; weight: string; reps: string }[];
  scheduleMode: 'weekly' | 'interval'; days: number[]; interval: string; startDate: string; injury: string;
};
export function createDraft(): Draft {
  return { goals: [], experience: null, unknownBests: false, unit: 'lb',
    bests: bestExercises.map(e => ({ exercise: e.id, weight: '', reps: '' })),
    scheduleMode: 'weekly', days: [1, 3, 5], interval: '3', startDate: calendarDay(), injury: '' };
}
export function toggleGoal(goals: string[], id: string): string[] {
  return goals.includes(id) ? goals.filter(g => g !== id) : goals.length < 3 ? [...goals, id] : goals;
}
export function dateFromDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  if (year < 2020 || year > 9999) return null;
  const result = new Date(year, month - 1, date, 12);
  return calendarDay(result) === day ? result : null;
}
export function validateStep(draft: Draft, step: number): string | null {
  if (step === 0 && (draft.goals.length !== 3 || new Set(draft.goals).size !== 3 || draft.goals.some(id => !goalGroups.some(g => g.goals.some(goal => goal.id === id))))) return 'Choose 3 goals to continue.';
  if (step === 1) {
    if (!draft.experience || !['beginner', 'experienced', 'advanced'].includes(draft.experience)) return 'Choose your experience level.';
    if (draft.experience !== 'beginner' && !draft.unknownBests) {
      const entered = draft.bests.filter(b => b.weight.trim() || b.reps.trim());
      if (!entered.length) return 'Add a personal best, or choose “I don’t know yet.”';
      if (entered.some(b => !/^\d+(\.\d{1,2})?$/.test(b.weight.trim()) || Number(b.weight) <= 0 || Number(b.weight) > 2000 || !/^\d+$/.test(b.reps.trim()) || Number(b.reps) < 1 || Number(b.reps) > 100)) return 'For each best, enter a weight above 0 (up to 2,000) and 1–100 reps.';
    }
  }
  if (step === 2) {
    if (draft.scheduleMode === 'weekly' && (!draft.days.length || draft.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return 'Choose at least one training day.';
    if (draft.scheduleMode === 'interval' && (!/^\d+$/.test(draft.interval) || Number(draft.interval) < 1 || Number(draft.interval) > 14 || !dateFromDay(draft.startDate) || Number(draft.startDate.slice(0, 4)) > 2100)) return 'Choose an interval from 1–14 days and a valid starting date in 2020–2100 (YYYY-MM-DD).';
  }
  if (step === 3 && draft.injury.length > 500) return 'Keep your injury note under 500 characters.';
  return null;
}
export function profilePayload(draft: Draft, completed: boolean): OnboardingProfile {
  return {
    goals: draft.goals,
    experience_level: draft.experience ?? 'beginner',
    personal_bests: draft.experience === 'beginner' || draft.unknownBests ? [] : draft.bests.filter(b => b.weight.trim()).map(b => ({ exercise: b.exercise, weight: Number(b.weight), unit: draft.unit, reps: Number(b.reps) })),
    schedule: draft.scheduleMode === 'weekly' ? { kind: 'weekly', days: [...new Set(draft.days)].sort() } : { kind: 'interval', every_days: Number(draft.interval), start_date: draft.startDate },
    onboarding_completed: completed,
  };
}
export function upcomingDays(draft: Draft, from = new Date()): string[] {
  if (validateStep(draft, 2)) return [];
  const cursor = draft.scheduleMode === 'interval' ? dateFromDay(draft.startDate)! : new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  const dates: string[] = [];
  // Interval dates before today are advanced using calendar days, including DST changes.
  const today = calendarDay(from);
  if (draft.scheduleMode === 'interval' && calendarDay(cursor) < today) {
    while (calendarDay(cursor) < today) cursor.setDate(cursor.getDate() + Number(draft.interval));
  }
  for (let i = 0; i < 42 && dates.length < 3; i++) {
    if (draft.scheduleMode === 'interval' || draft.days.includes(cursor.getDay())) dates.push(calendarDay(cursor));
    cursor.setDate(cursor.getDate() + (draft.scheduleMode === 'interval' ? Number(draft.interval) : 1));
  }
  return dates;
}
/** Normalized app profile; transport casing and level mapping live in api.ts. */
export function parseProfile(value: unknown): OnboardingProfile | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as OnboardingProfile;
  if (!Array.isArray(p.goals) || !Array.isArray(p.personal_bests) || typeof p.onboarding_completed !== 'boolean' || !p.schedule || typeof p.schedule !== 'object') return null;
  if (!['beginner', 'experienced', 'advanced'].includes(p.experience_level)) return null;
  if (p.goals.length > 3 || new Set(p.goals).size !== p.goals.length || p.goals.some(id => !goalGroups.some(group => group.goals.some(goal => goal.id === id)))) return null;
  if (p.injury_note !== undefined && (typeof p.injury_note !== 'string' || p.injury_note.length > 500)) return null;
  if (p.personal_bests.some(b => !b || !bestExercises.some(e => e.id === b.exercise) || !['lb', 'kg'].includes(b.unit) || !Number.isFinite(b.weight) || b.weight <= 0 || b.weight > 2000 || !Number.isInteger(b.reps) || b.reps < 1 || b.reps > 100)) return null;
  if (p.schedule.kind !== 'weekly' && p.schedule.kind !== 'interval') return null;
  if (p.schedule.kind === 'weekly' && !Array.isArray(p.schedule.days)) return null;
  if (p.schedule.kind === 'interval' && (typeof p.schedule.start_date !== 'string' || !Number.isInteger(p.schedule.every_days))) return null;
  const draft = draftFromProfile(p);
  return validateStep(draft, 2) || (p.onboarding_completed && [0, 1].some(step => validateStep(draft, step))) ? null : p;
}
export function draftFromProfile(p: OnboardingProfile): Draft {
  const draft = createDraft();
  return { ...draft, injury: p.injury_note ?? '', goals: p.goals, experience: p.experience_level, unknownBests: !p.personal_bests.length,
    unit: p.personal_bests[0]?.unit ?? 'lb',
    bests: draft.bests.map(b => { const best = p.personal_bests.find(pb => pb.exercise === b.exercise); return best ? { exercise: b.exercise, weight: String(best.unit === (p.personal_bests[0]?.unit ?? 'lb') ? best.weight : best.unit === 'kg' ? Math.round(best.weight * 2.20462 * 100) / 100 : Math.round(best.weight / 2.20462 * 100) / 100), reps: String(best.reps) } : b; }),
    scheduleMode: p.schedule.kind, days: p.schedule.kind === 'weekly' ? p.schedule.days : draft.days,
    interval: p.schedule.kind === 'interval' ? String(p.schedule.every_days) : draft.interval,
    startDate: p.schedule.kind === 'interval' ? p.schedule.start_date : draft.startDate };
}
