import { uploadLiveSet } from '../workoutApi';
import type { UploadCheckpoint } from '../workoutApi';
const start = { started_at: '2026-10-10T12:00:00Z', device: 'phone', inference_mode: 'vision' as const };
const set = { schema_version: 1 as const, set_index: 2, exercise_id: 'squat', weight_kg: null, end_reason: 'manual' as const, partial_reps: 0, fps: null, frames: [], reps: [] };
const response = (status: number, body: object) => ({ ok: status < 400, status, json: async () => body }) as Response;
it('saves a measured set during rest and returns the server note', async () => {
  const result = { score: { medal: 'gold', source: 'phone' }, rest_note: { text: '4 of 4 reps were clean.', source: 'fixed', rule_id: null } };
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'one-session' })).mockResolvedValueOnce(response(201, result));
  const checkpoint: UploadCheckpoint = {};
  expect(await uploadLiveSet(request, checkpoint, start, set)).toEqual(result);
  expect(JSON.parse(request.mock.calls[1][1].body).set_index).toBe(2);
  expect(request.mock.calls).toHaveLength(2);
  expect(checkpoint.sessionId).toBe('one-session');
});
it('does not restart the session after a duplicate set and leaves advice to the phone', async () => {
  const request = jest.fn().mockResolvedValue(response(409, {}));
  expect(await uploadLiveSet(request, { sessionId: 'same' }, start, { ...set, set_index: 0 })).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
