import { upcomingWorkouts } from '../plan';
const schedule = { kind: 'weekly' as const, days: [1, 3, 5] };
test('starts on Thursday and returns three workouts across the Monday boundary', () => {
 const result = upcomingWorkouts('2026-10-08', schedule, null);
 expect(result.map(day => day.date)).toEqual(['2026-10-09', '2026-10-12', '2026-10-14']);
 expect(result.every(day => day.items.length === 3)).toBe(true);
});
test('interval workouts cross month boundaries and skip a completed today', () => {
 const schedule = { kind: 'interval' as const, every_days: 3, start_date: '2026-10-29' };
 const history = [{ id: 'done', day: '2026-10-29', finishedAt: '2026-10-29T10:00:00Z', sets: 3, reps: 30, minutes: 5 }];
 expect(upcomingWorkouts('2026-10-29', schedule, null, history).map(day => day.date)).toEqual(['2026-11-01', '2026-11-04', '2026-11-07']);
});
test('a generated week keeps real exercises and rest days, then uses the local schedule', () => {
 const item = { id: 'squat', name: 'Squat', sets: 2, reps: 8, tracked: true, itemId: 'squat-1', position: 0, reason: 'Strength', swapNote: null, safetyNote: null, sources: [] };
 const plan = { id: 'week', weekOf: '2026-10-05', notes: [], days: [{ day: 5, date: '2026-10-10', items: [item] }] };
 const result = upcomingWorkouts('2026-10-08', schedule, plan);
 expect(result.map(day => day.date)).toEqual(['2026-10-10', '2026-10-12', '2026-10-14']);
 expect(result[0].items).toEqual([item]);
 expect(upcomingWorkouts('2026-10-08', { kind: 'weekly', days: [] }, null)).toEqual([]);
});
