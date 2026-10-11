import { phoneSummary, readFinishResult, medalExplanation } from '../summary';
const set = (clean: number, total: number) => ({ exercise_id: 'squat', reps: Array.from({ length: total }, (_, i) => ({ tempo_ms: 2000, range_deg: 100, quality: null, flags: i < clean ? [] : [{ rule_id: 'depth', severity: 'warn' }] })) });
it('uses the INT-06 thresholds and a session average, excluding old and unmeasured history', () => {
 const history = [{ id: 'previous', day: '2026-10-09', finishedAt: '2026-10-09T12:00:00Z', sets: 1, reps: 10, minutes: 3, details: [{ exercise_id: 'squat', reps: 10, goodReps: 8 }] }];
 expect(phoneSummary([set(8, 10)], history, Date.parse('2026-10-10T12:00:00Z'))).toMatchObject({ medal: 'silver', form_score: .8, baseline_share: .8 });
 expect(phoneSummary([set(10, 10)], [], Date.now()).medal).toBe('gold');
 expect(phoneSummary([set(6, 10)], [], Date.now()).medal).toBe('bronze');
 expect(medalExplanation('gold')).toMatch(/Every rep/);
});
it('never invents a measured form score for manual reps or PRs for an offline workout', () => {
 const manual = set(0, 1); manual.reps[0].flags = [{ rule_id: 'manual_unscored', severity: 'info' }];
 expect(phoneSummary([manual], [], Date.now())).toMatchObject({ form_score: null, personal_records: [] });
});
it('validates the snake-case finish response, including PRs', () => {
 const result = { session_id: 'session', medal: 'gold', form_score: 1, baseline_share: .7, total_reps: 10, clean_reps: 10, personal_records: [{ exercise_id: 'squat', metric: 'max_reps', value: 10, previous_value: 8 }] };
 expect(readFinishResult(result)).toEqual(result);
 expect(readFinishResult({ ...result, form_score: 3 })).toBeNull();
 expect(readFinishResult({ ...result, clean_reps: 11 })).toBeNull();
});
