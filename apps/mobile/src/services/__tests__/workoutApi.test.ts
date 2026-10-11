import { uploadWorkout, type UploadCheckpoint, type WorkoutSet } from '../workoutApi';
const sessionStart = { started_at: '2026-10-10T12:00:00Z', device: 'phone', inference_mode: 'vision' as const };
const set: WorkoutSet = {
  schema_version: 1, set_index: 3, exercise_id: 'squat', weight_kg: null,
  end_reason: 'manual', partial_reps: 0, fps: null, frames: [],
  reps: [{ rep_index: 0, start_ms: 0, end_ms: 2000, tempo_ms: 2000, range_deg: 95,
    quality: null, lowering_ms: 1000, rising_ms: 1000, flags: [] }],
};
const summary = { session_id: 'session-id', medal: 'gold', form_score: 1, baseline_share: .7, total_reps: 1, clean_reps: 1, personal_records: [] };
function response(status: number, body: object = summary) { return { ok: status < 400, status, json: async () => body } as Response; }

it('uploads the phone record and finishes only after its sets commit', async () => {
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'session-id' })).mockResolvedValue(response(200));
  const checkpoint: UploadCheckpoint = {};
  await uploadWorkout(request, checkpoint, sessionStart, [set]);
  expect(request.mock.calls.map(call => call[0])).toEqual(['/sessions', '/sessions/session-id/sets', '/sessions/session-id/finish']);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(sessionStart);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual(set);
  expect(checkpoint.finished).toBe(true);
});
it('resumes after a lost set response using the existing session and explicit indices', async () => {
  const checkpoint: UploadCheckpoint = {};
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'same-id' })).mockRejectedValueOnce(new Error('offline'));
  await expect(uploadWorkout(request, checkpoint, sessionStart, [set])).rejects.toThrow('offline');
  request.mockResolvedValueOnce(response(409)).mockResolvedValueOnce(response(200));
  await uploadWorkout(request, checkpoint, sessionStart, [set]);
  expect(request.mock.calls.filter(call => call[0] === '/sessions')).toHaveLength(1);
  expect(checkpoint.finished).toBe(true);
});
it('handles a lost finish response and never repeats a confirmed finish', async () => {
  const checkpoint: UploadCheckpoint = { sessionId: 'already-finished' };
  const request = jest.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/summary') ? response(200) : response(409)));
  await uploadWorkout(request, checkpoint, sessionStart, [set]);
  await uploadWorkout(request, checkpoint, sessionStart, [set]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(checkpoint.result).toEqual(summary);

});
