import { dailyWorkout } from '../workout';
import { readPrescription } from '@/screens/Planner/plan';

test('a preferred first exercise changes order without changing prescriptions', () => {
 const original = dailyWorkout('2026-10-11');
 const routine = dailyWorkout('2026-10-11', 'lunge');
 expect(routine[0].id).toBe('lunge');
 expect(routine).toEqual([original.find(e => e.id === 'lunge'), ...original.filter(e => e.id !== 'lunge')]);
 expect(dailyWorkout('2026-10-11')).toEqual(original);
 expect(dailyWorkout('2026-10-11', 'curl')).toEqual(original);
});

test('a daily routine is stable, full body, and supported by camera tracking', () => {
 const routine = dailyWorkout('2026-10-11');
 expect(dailyWorkout('2026-10-11')).toEqual(routine);
 expect(routine).toHaveLength(3);
 expect(new Set(routine.map(e => e.id)).size).toBe(3);
 expect(routine.some(e => ['squat', 'lunge'].includes(e.id))).toBe(true);
 expect(routine.some(e => ['push_up', 'press'].includes(e.id))).toBe(true);
 expect(readPrescription(routine)).toHaveLength(3);
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

test('three-exercise days retain full-body coverage and rotate through the catalog', () => {
 const seen = new Set<string>();
 for (let day = 1; day <= 31; day++) {
  const routine = dailyWorkout(`2026-10-${String(day).padStart(2, '0')}`);
  expect(routine).toHaveLength(3);
  expect(routine.some(e => ['squat', 'lunge'].includes(e.id))).toBe(true);
  expect(routine.some(e => ['push_up', 'press'].includes(e.id))).toBe(true);
  routine.forEach(e => seen.add(e.id));
 }
 expect([...seen].sort()).toEqual(['curl', 'lunge', 'press', 'push_up', 'squat']);
});
