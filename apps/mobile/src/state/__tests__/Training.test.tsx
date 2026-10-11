/* eslint-disable @typescript-eslint/no-require-imports -- Matches existing renderer tests. */
import React from 'react';
import { createMMKV } from 'react-native-mmkv';
import { TrainingProvider, useTraining } from '../Training';
import { initialProfile, readSaved, workoutsOnDay } from '@/data/workout';
const { act, create } = require('react-test-renderer');
let training: ReturnType<typeof useTraining>;
function Probe() { const value = useTraining(); React.useEffect(() => { training = value; }, [value]); return null; }
const raw = createMMKV({ id: 'training' });
beforeEach(() => raw.clearAll());
it('persists native details across remounts, isolates account switches, and preserves guest history', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<TrainingProvider><Probe /></TrainingProvider>); });
  act(() => { training.finish(1, 8, 2, [{ exercise_id: 'lunge', reps: 8, goodReps: 6, medal: 'silver' }]); });
  act(() => { screen.update(<TrainingProvider accountId="a"><Probe /></TrainingProvider>); });
  expect(training.workouts).toHaveLength(0);
  act(() => { training.finish(1, 10, 3, [{ exercise_id: 'push_up', reps: 10 }]); });
  act(() => { screen.update(<TrainingProvider accountId="b"><Probe /></TrainingProvider>); });
  expect(training.workouts).toHaveLength(0);
  act(() => { screen.unmount(); screen = create(<TrainingProvider accountId="a"><Probe /></TrainingProvider>); });
  expect(training.workouts[0].details).toEqual([{ exercise_id: 'push_up', reps: 10 }]);
  act(() => { screen.update(<TrainingProvider><Probe /></TrainingProvider>); });
  expect(training.workouts[0].details?.[0].goodReps).toBe(6);
  act(() => { training.removeWorkout(training.workouts[0].id); screen.unmount(); });
  act(() => { screen = create(<TrainingProvider><Probe /></TrainingProvider>); });
  expect(training.workouts).toHaveLength(0);
  act(() => screen.unmount());
});
it('retains legacy aggregates and sanitizes malformed optional details', () => {
  const legacy = { id: 'old', day: '2026-10-10', finishedAt: '2026-10-10T10:00:00Z', reps: 20, sets: 2, minutes: 4 };
  const saved = readSaved({ profile: initialProfile, workouts: [legacy, { ...legacy, id: 'new', finishedAt: '2026-10-10T15:00:00Z', details: [{ exercise_id: 'lunge', reps: 8, goodReps: 99 }, { exercise_id: '', reps: 9 }] }] })!;
  expect(saved.workouts[0].details).toBeUndefined();
  expect(saved.workouts[1].details).toEqual([{ exercise_id: 'lunge', reps: 8 }]);
  expect(workoutsOnDay(saved.workouts, '2026-10-10').map(workout => workout.id)).toEqual(['new', 'old']);
  expect(workoutsOnDay(saved.workouts, '2026-10-09')).toEqual([]);
});
