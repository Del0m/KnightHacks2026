import { uploadWorkout, type UploadCheckpoint, type WorkoutSet } from '../workoutApi';
const set: WorkoutSet = { exercise_id: 'squat', reps: [{ tempo_ms: 2000, range_deg: 95, quality: 0.9, flags: [] }] };
function response(status: number, body = {}) { return { ok: status < 400, status, json: async () => body } as Response; }
it('uploads the phone record and finishes only after its sets commit', async () => {
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'session-id' })).mockResolvedValue(response(200));
  const checkpoint: UploadCheckpoint = {};
  await uploadWorkout(request, checkpoint, '2026-10-10T12:00:00Z', [set]);
  expect(request.mock.calls.map(call => call[0])).toEqual(['/sessions', '/sessions/session-id/sets', '/sessions/session-id/finish']);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ ...set, set_index: 0 });
  expect(checkpoint.finished).toBe(true);
});
it('resumes after a lost set response using the existing session and explicit indices', async () => {
  const checkpoint: UploadCheckpoint = {};
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'same-id' })).mockRejectedValueOnce(new Error('offline'));
  await expect(uploadWorkout(request, checkpoint, '2026-10-10T12:00:00Z', [set])).rejects.toThrow('offline');
  request.mockResolvedValueOnce(response(409)).mockResolvedValueOnce(response(200));
  await uploadWorkout(request, checkpoint, '2026-10-10T12:00:00Z', [set]);
  expect(request.mock.calls.filter(call => call[0] === '/sessions')).toHaveLength(1);
  expect(checkpoint.finished).toBe(true);
});
it('handles a lost finish response and never repeats a confirmed finish', async () => {
  const checkpoint: UploadCheckpoint = { sessionId: 'already-finished' };
  const request = jest.fn().mockResolvedValue(response(409));
  await uploadWorkout(request, checkpoint, '2026-10-10T12:00:00Z', [set]);
  await uploadWorkout(request, checkpoint, '2026-10-10T12:00:00Z', [set]);
  expect(request).toHaveBeenCalledTimes(2);
});
