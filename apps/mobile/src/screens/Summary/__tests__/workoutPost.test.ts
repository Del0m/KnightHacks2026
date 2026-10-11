import { readPublicWorkout, workoutPost } from '../workoutPost';
const rep = { tempo_ms: 2000, range_deg: 100, quality: null, flags: [] };
const result = { medal: 'silver' as const, form_score: .8, baseline_share: .7, total_reps: 3, clean_reps: 3, personal_records: [] };
test('shares completed exercises and positive measured progress without private faults', () => {
  const post = workoutPost([{ exercise_id: 'squat', reps: [rep, rep] }, { exercise_id: 'squat', reps: [rep] }], result, '2026-10-10', true);
  expect(post.data.workout.exercises).toEqual([{ id: 'squat', name: 'Squat', sets: 2, reps: 3 }]);
  expect(post.data.workout.highlights).toContain('Form improved by 10 percentage points over the 28-day average.');
  expect(post.body).toContain('Squat'); expect(post.data.tier).toBe('silver');
  expect(JSON.stringify(post)).not.toContain('flags');
});
test('no history or declining form gets positive completion language, never invented improvement', () => {
  for (const r of [result, { ...result, form_score: .4 }]) {
    const post = workoutPost([{ exercise_id: 'squat', reps: [rep] }], r, '2026-10-10', false);
    expect(post.data.workout.highlights).toEqual(['Completed 1 set and 1 rep.']);
  }
});
test('manual reps do not generate a form-improvement claim', () => {
  const post = workoutPost([{ exercise_id: 'squat', reps: [{ ...rep, flags: [{ rule_id: 'manual_unscored', severity: 'info' }] }] }], { ...result, personal_records: [{ exercise_id: 'squat', metric: 'max_reps', value: 12, previous_value: 10 }] }, '2026-10-10', true);
  expect(post.data.form_score).toBeNull(); expect(post.data.clean_reps).toBeNull();
  expect(post.data.workout.highlights[0]).toBe('Completed 1 set and 1 rep.');
});
test('new summaries parse and older or malformed summaries fall back to their post body', () => {
  const post = workoutPost([{ exercise_id: 'squat', reps: [rep] }], result, '2026-10-10', false);
  expect(readPublicWorkout(post.data)).toEqual(post.data.workout);
  expect(readPublicWorkout({ tier: 'gold' })).toBeNull();
  expect(readPublicWorkout({ workout: { ...post.data.workout, exercises: [{ ...post.data.workout.exercises[0], sets: -1 }] } })).toBeNull();
});
test('a new personal record is a positive highlight even when form decreased', () => {
  const post = workoutPost([{ exercise_id: 'squat', reps: [rep] }], { ...result, form_score: .4, personal_records: [{ exercise_id: 'squat', metric: 'max_reps', value: 12, previous_value: 10 }] }, '2026-10-10', true);
  expect(post.data.workout.highlights).toEqual(['Squat: new rep best of 12 reps.']);
});
