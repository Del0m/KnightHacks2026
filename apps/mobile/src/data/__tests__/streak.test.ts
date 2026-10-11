import { streak, isWorkoutDay, type Workout } from '../workout';
const workout = (day: string): Workout => ({ id: day, day, finishedAt: `${day}T18:00:00Z`, sets: 3, reps: 30, minutes: 5 });
const weekly = { kind: 'weekly' as const, days: [1, 3, 5] };
const at = (day: number) => new Date(2026, 9, day, 12);
test('MWF streak survives rest days and an unfinished workout day', () => {
 const history = [workout('2026-10-05'), workout('2026-10-07')];
 expect(streak(history, at(8), weekly)).toBe(2);
 expect(streak(history, at(9), weekly)).toBe(2);
 expect(streak(history, at(10), weekly)).toBe(0);
 expect(streak([...history, workout('2026-10-09')], at(11), weekly)).toBe(3);
});
test('interval schedules skip rest days, support date boundaries, and count each date once', () => {
 const schedule = { kind: 'interval' as const, every_days: 3, start_date: '2026-09-28' };
 expect(isWorkoutDay('2026-10-01', schedule)).toBe(true);
 expect(isWorkoutDay('2026-09-27', schedule)).toBe(false);
 const history = [workout('2026-09-28'), workout('2026-10-01'), workout('2026-10-01')];
 expect(streak(history, at(3), schedule)).toBe(2);
 expect(streak(history, at(4), schedule)).toBe(2);
 expect(streak(history, at(5), schedule)).toBe(0);
});
test('empty history, future records and empty schedules terminate safely', () => {
 expect(streak([], at(11), weekly)).toBe(0);
 expect(streak([workout('2026-10-12')], at(11), weekly)).toBe(0);
 expect(streak([workout('2026-10-05')], at(11), { kind: 'weekly', days: [] })).toBe(1);
});
