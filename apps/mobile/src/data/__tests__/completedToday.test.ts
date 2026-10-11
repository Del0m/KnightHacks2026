import { completedToday, type Workout } from '../workout';
test('only a full exercise prescription today earns a check across saved sessions', () => {
  const workout = (day: string, count: number): Workout => ({ id: day, day, finishedAt: `${day}T12:00:00Z`, sets: count, reps: count * 12, minutes: 2, details: Array.from({ length: count }, () => ({ exercise_id: 'bicep_curl', reps: 12 })) });
  expect(completedToday([workout('2026-10-09', 3), workout('2026-10-10', 2)], 'bicep_curl', 3, '2026-10-10')).toBe(false);
  expect(completedToday([workout('2026-10-10', 2), workout('2026-10-10', 1)], 'bicep_curl', 3, '2026-10-10')).toBe(true);
  expect(completedToday([workout('2026-10-10', 3)], 'squat', 3, '2026-10-10')).toBe(false);
});
