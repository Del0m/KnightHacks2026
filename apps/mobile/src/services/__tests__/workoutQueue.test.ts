import { queueWorkout, syncWorkouts, readFailedWorkouts, readWorkoutResult, saveActiveWorkout, readActiveWorkout, clearActiveWorkout } from '../workoutQueue';
const sessionStart = { inference_mode: 'coreml' as const };
const measured = { schema_version: 1 as const, set_index: 0, exercise_id: 'squat', weight_kg: null, end_reason: 'manual' as const, partial_reps: 0, fps: null, frames: [], reps: [] };
const mockData = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: (k: string) => mockData.get(k), set: (k: string, v: string) => mockData.set(k, v) }) }));
const response = (status: number, body: object = { session_id: 'existing', medal: 'bronze', form_score: 0, baseline_share: .7, total_reps: 0, clean_reps: 0, personal_records: [] }) => ({ ok: status < 400, status, json: async () => body }) as Response;
beforeEach(() => mockData.clear());
it('retains failed saves and retries their original session without crossing accounts', async () => {
  queueWorkout('a', { id: 'local', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: {} });
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
  queueWorkout('a', { id: 'bad', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: { sessionId: 'bad-session' } });
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

it('makes unfinished sets durable and uploads them without finalizing the session', async () => {
 const draft = { id: 'active', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: {}, feedbacks: [null], exercise: 'squat', mode: 'camera' as const, restUntil: Date.now() + 45000 };
 saveActiveWorkout('a', draft);
 expect(readActiveWorkout('a')?.sets).toEqual([measured]); expect(readActiveWorkout('b')).toBeNull();
 const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'session' })).mockResolvedValue(response(201));
 await syncWorkouts('a', request);
 expect(request.mock.calls.map(c => c[0])).toEqual(['/sessions', '/sessions/session/sets']);
 expect(readActiveWorkout('a')?.checkpoint.sessionId).toBe('session');
 clearActiveWorkout('a', 'different'); expect(readActiveWorkout('a')).not.toBeNull();
 clearActiveWorkout('a', 'active'); expect(readActiveWorkout('a')).toBeNull();
});
it('retries an active set after a lost response with the same session and set index, then finalizes separately', async () => {
 const draft = { id: 'active', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: {}, feedbacks: [null], exercise: 'squat', mode: 'camera' as const, restUntil: 0 };
 saveActiveWorkout('a', draft);
 const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'session' })).mockRejectedValueOnce(new Error('offline'));
 await expect(syncWorkouts('a', request)).rejects.toThrow('offline');
 const restored = readActiveWorkout('a')!; expect(restored.sets).toHaveLength(1); expect(restored.checkpoint.sessionId).toBe('session');
 request.mockResolvedValue(response(409)); await syncWorkouts('a', request);
 expect(request.mock.calls.filter(c => c[0] === '/sessions')).toHaveLength(1);
 expect(request.mock.calls.some(c => c[0].endsWith('/finish'))).toBe(false);
 queueWorkout('a', { ...readActiveWorkout('a')!, phase: 'finish' }); request.mockResolvedValue(response(200));
 await syncWorkouts('a', request); expect(request.mock.calls.at(-1)![0]).toBe('/sessions/session/finish');
 expect(request.mock.calls.filter(c => c[0].endsWith('/sets')).every(c => JSON.parse(c[1].body).set_index === 0)).toBe(true);
});
it('keeps guest/manual active sets local and restores them without assigning them to an account', async () => {
 saveActiveWorkout(null, { id: 'guest', startedAt: '2026-10-10T12:00:00Z', sets: [{ exercise_id: 'squat', reps: [] }], checkpoint: {}, feedbacks: [null], exercise: 'squat', mode: 'manual', restUntil: 0 });
 expect(readActiveWorkout(null)?.id).toBe('guest'); expect(readActiveWorkout('a')).toBeNull();
 const request = jest.fn(); await syncWorkouts('a', request); expect(request).not.toHaveBeenCalled();
});

it('retains a second set queued while the first upload is in flight', async () => {
 const draft = { id: 'racing', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: {}, feedbacks: [null], exercise: 'squat', mode: 'camera' as const, restUntil: 0 };
 saveActiveWorkout('a', draft);
 let release!: (r: Response) => void;
 const request = jest.fn().mockResolvedValueOnce(response(201, { id: 'session' })).mockImplementationOnce(() => new Promise<Response>(r => { release = r; })).mockResolvedValue(response(201));
 const worker = syncWorkouts('a', request);
 while (!release) await Promise.resolve();
 saveActiveWorkout('a', { ...draft, sets: [measured, { ...measured, set_index: 1 }], feedbacks: [null, null] });
 release(response(201)); await worker;
 expect(readActiveWorkout('a')?.sets).toHaveLength(2);
 expect(request.mock.calls.filter(c => c[0] === '/sessions')).toHaveLength(1);
 expect(request.mock.calls.filter(c => c[0].endsWith('/sets')).map(c => JSON.parse(c[1].body).set_index)).toEqual([0, 0, 1]);
 expect(request.mock.calls.some(c => c[0].endsWith('/finish'))).toBe(false);
});
it('keeps a finish queued during an active upload and does not lose the created session checkpoint', async () => {
 const draft = { id: 'finishing', startedAt: '2026-10-10T12:00:00Z', sets: [measured], sessionStart, checkpoint: {}, feedbacks: [null], exercise: 'squat', mode: 'camera' as const, restUntil: 0 };
 saveActiveWorkout('a', draft);
 let release!: (r: Response) => void;
 const request = jest.fn().mockImplementationOnce(() => new Promise<Response>(r => { release = r; })).mockResolvedValue(response(200));
 const worker = syncWorkouts('a', request);
 queueWorkout('a', { ...draft, phase: 'finish' }); release(response(201, { id: 'session' })); await worker;
 expect(request.mock.calls.filter(c => c[0] === '/sessions')).toHaveLength(1);
 expect(request.mock.calls.filter(c => c[0].endsWith('/finish'))).toHaveLength(1);
 expect(readWorkoutResult('a', 'finishing')).not.toBeNull();
});
