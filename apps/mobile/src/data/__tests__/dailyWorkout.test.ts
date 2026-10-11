import { dailyWorkout } from '../workout';
import { readPrescription } from '@/screens/Planner/plan';

test('a daily routine is stable, full body, and supported by camera tracking', () => {
 const routine = dailyWorkout('2026-10-11');
 expect(dailyWorkout('2026-10-11')).toEqual(routine);
 expect(routine.map(e => e.id).sort()).toEqual(['curl', 'lunge', 'press', 'push_up', 'squat']);
 expect(readPrescription(routine)).toHaveLength(5);
 for (const item of routine) {
  expect(item.tracked).toBe(true);
  expect(item.sets).toBeGreaterThanOrEqual(2);
  expect(item.sets).toBeLessThanOrEqual(3);
  expect(item.reps).toBeGreaterThanOrEqual(8);
  expect(item.reps).toBeLessThanOrEqual(12);
 }
});
test('each day in a month has a different routine, including month boundaries', () => {
 const routines = Array.from({ length: 31 }, (_, i) => JSON.stringify(dailyWorkout(`2026-10-${String(i + 1).padStart(2, '0')}`)));
 expect(new Set(routines).size).toBe(31);
 expect(dailyWorkout('2026-10-31')).not.toEqual(dailyWorkout('2026-11-01'));
 expect(dailyWorkout('2026-12-31')).not.toEqual(dailyWorkout('2027-01-01'));
});
test('callers cannot mutate the next daily routine', () => {
 const routine = dailyWorkout('2026-10-11');
 routine[0].reps = 99;
 routine.reverse();
 expect(dailyWorkout('2026-10-11')[0].reps).toBeLessThanOrEqual(12);
});
