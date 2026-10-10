import { queueWorkout, syncWorkouts, readFailedWorkouts, readWorkoutResult } from '../workoutQueue';
const mockData = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: (k: string) => mockData.get(k), set: (k: string, v: string) => mockData.set(k, v) }) }));
const response = (status: number, body: object = { session_id: 'existing', medal: 'bronze', form_score: 0, baseline_share: .7, total_reps: 0, clean_reps: 0, personal_records: [] }) => ({ ok: status < 400, status, json: async () => body }) as Response;
beforeEach(() => mockData.clear());
it('retains failed saves and retries their original session without crossing accounts', async () => {
  queueWorkout('a', { id: 'local', startedAt: '2026-10-10T12:00:00Z', sets: [{ exercise_id: 'squat', reps: [] }], checkpoint: {} });
  const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'existing' })).mockRejectedValueOnce(new Error('offline'));
  await expect(syncWorkouts('a', request)).rejects.toThrow('offline');
  await syncWorkouts('b', request);
  expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValue(response(200));
  await syncWorkouts('a', request);
  expect(request.mock.calls.filter(call => call[0] === '/sessions')).toHaveLength(1);
  await syncWorkouts('a', request);
  expect(request).toHaveBeenCalledTimes(4);
});
it('persists a finished workout immediately while its rest upload settles', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  queueWorkout('a', { id: 'waiting', startedAt: '2026-10-10T12:00:00Z', sets: [], checkpoint: { sessionId: 'existing' } }, wait);
  expect([...mockData.values()].join()).toContain('waiting');
  const request = jest.fn().mockResolvedValue(response(200));
  await syncWorkouts('a', request);
  expect(request).not.toHaveBeenCalled();
  release(); await wait; await Promise.resolve();
  await syncWorkouts('a', request);
  expect(request).toHaveBeenCalledTimes(1);
});
it('retains the authoritative finish result after the queued workout is removed', async () => {
 const result = { session_id: 'server', medal: 'gold', form_score: 1, baseline_share: .7, total_reps: 1, clean_reps: 1, personal_records: [] };
 queueWorkout('a', { id: 'local', startedAt: '2026-10-10T12:00:00Z', sets: [], checkpoint: { sessionId: 'server' } });
 await syncWorkouts('a', jest.fn().mockResolvedValue(response(200, result)));
 expect(readWorkoutResult('a', 'local')).toEqual(result);
 expect(readWorkoutResult('b', 'local')).toBeNull();
});

it.each([400, 404, 422])('preserves an HTTP %s rejection separately and continues later workouts', async status => {
  queueWorkout('a', { id: 'bad', startedAt: '2026-10-10T12:00:00Z', sets: [{ exercise_id: 'squat', reps: [] }], checkpoint: { sessionId: 'bad-session' } });
  queueWorkout('a', { id: 'good', startedAt: '2026-10-10T12:00:00Z', sets: [], checkpoint: { sessionId: 'good-session' } });
  const request = jest.fn().mockImplementation((path: string) => Promise.resolve(response(path.includes('bad-session') ? status : 200)));
  await expect(syncWorkouts('a', request)).rejects.toThrow();
  expect(request).toHaveBeenCalledWith('/sessions/good-session/finish', expect.anything());
  expect(readFailedWorkouts('a')).toMatchObject([{ id: 'bad', status, checkpoint: { sessionId: 'bad-session' } }]);
  expect(readFailedWorkouts('b')).toEqual([]);
  const count = request.mock.calls.length;
  await syncWorkouts('a', request);
  expect(request).toHaveBeenCalledTimes(count);
});
it.each([401, 403, 408, 429, 500])('keeps HTTP %s failures retryable', async status => {
  queueWorkout('a', { id: 'retry', startedAt: '2026-10-10T12:00:00Z', sets: [], checkpoint: { sessionId: 'retry-session' } });
  const request = jest.fn().mockResolvedValue(response(status));
  await expect(syncWorkouts('a', request)).rejects.toThrow();
  expect(readFailedWorkouts('a')).toEqual([]);
  request.mockResolvedValue(response(200));
  await syncWorkouts('a', request);
  expect(request).toHaveBeenCalledTimes(2);
});
