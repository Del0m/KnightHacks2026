import { readPrescription } from '@/screens/Planner/plan';
import type { SetFeedback } from '@/screens/LiveSet/setRecord';
import type { ServerRestResult } from '@/screens/LiveSet/restCardContent';
import type { SessionStart } from '../../../../specs/set-record/types';
import { readFinishResult, type FinishResult } from '@/screens/Summary/summary';
import { Platform } from 'react-native';
import type { MMKV } from 'react-native-mmkv';
import { WorkoutUploadError, isPermanentUploadFailure, uploadWorkout, type ApiRequest, type UploadCheckpoint, type WorkoutSet } from './workoutApi';
type Pending = { phase?: 'active' | 'finish'; sessionStart?: SessionStart; id: string; startedAt: string; sets: WorkoutSet[]; checkpoint: UploadCheckpoint };
let storage: MMKV | undefined;
const key = (account: string) => `workout-queue:${encodeURIComponent(account)}`;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Do not load native Nitro modules during web SSR.
const native = () => storage ??= (require('react-native-mmkv') as typeof import('react-native-mmkv')).createMMKV({ id: 'workout-sync' });
function read(account: string): Pending[] {
  try { const raw = Platform.OS === 'web' ? localStorage.getItem(key(account)) : native().getString(key(account)); const value = JSON.parse(raw ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v?.id === 'string' && typeof v.startedAt === 'string' && Array.isArray(v.sets) && v.checkpoint && typeof v.checkpoint === 'object') : []; } catch { return []; }
}
function write(account: string, pending: Pending[]) { const data = JSON.stringify(pending); if (Platform.OS === 'web') localStorage.setItem(key(account), data); else native().set(key(account), data); }
type FailedWorkout = Pending & { status: number; failedAt: string };
export function readFailedWorkouts(account: string): FailedWorkout[] {
  try { const k = `${key(account)}:failed`, raw = Platform.OS === 'web' ? localStorage.getItem(k) : native().getString(k); const rows = JSON.parse(raw ?? '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
}
function retainFailedWorkout(account: string, workout: Pending, status: number) {
  const k = `${key(account)}:failed`, rows = [...readFailedWorkouts(account).filter(w => w.id !== workout.id), { ...workout, status, failedAt: new Date().toISOString() }], data = JSON.stringify(rows);
  if (Platform.OS === 'web') localStorage.setItem(k, data); else native().set(k, data);
}
const blocked = new Set<string>();
export function queueWorkout(account: string, pending: Pending, wait?: Promise<unknown>) {
  const job = `${account}/${pending.id}`;
  if (wait) blocked.add(job);
  const existing = read(account), index = existing.findIndex(p => p.id === pending.id);
  if (index >= 0) existing[index] = pending; else existing.push(pending);
  write(account, existing);
  if (wait) void wait.finally(() => { queueWorkout(account, pending); blocked.delete(job); }).catch(() => {});
}
export type ActiveWorkout = Pending & { feedbacks: (SetFeedback | null)[]; exercise: string; mode: 'camera' | 'manual'; cameraPosition?: 'front' | 'back'; restUntil: number; routine?: import('@/screens/Planner/plan').Prescription[]; planDate?: string; planId?: string };
const activeKey = (account: string | null) => `workout-active:${account ? `account:${encodeURIComponent(account)}` : 'guest'}`;
function storeActive(account: string | null, value: ActiveWorkout | null) {
  const data = JSON.stringify(value), k = activeKey(account);
  if (Platform.OS === 'web') localStorage.setItem(k, data); else native().set(k, data);
}
export function readActiveWorkout(account: string | null): ActiveWorkout | null {
  try {
    const k = activeKey(account), raw = Platform.OS === 'web' ? localStorage.getItem(k) : native().getString(k), v = JSON.parse(raw ?? 'null');
    if (v?.routine !== undefined && !readPrescription(v.routine)) return null;
    return v && typeof v.id === 'string' && typeof v.startedAt === 'string' && Number.isFinite(Date.parse(v.startedAt)) && Array.isArray(v.sets) && v.sets.every((s: WorkoutSet) => s && typeof s.exercise_id === 'string' && Array.isArray(s.reps)) && Array.isArray(v.feedbacks) && v.feedbacks.length === v.sets.length && v.checkpoint && typeof v.exercise === 'string' && ['camera', 'manual'].includes(v.mode) && Number.isFinite(v.restUntil) ? v : null;
  } catch { return null; }
}
export function saveActiveWorkout(account: string | null, workout: ActiveWorkout) {
  // Synchronous storage precedes the queue and every React/navigation update.
  const previous = readActiveWorkout(account);
  if (previous?.id === workout.id) workout = { ...workout, checkpoint: { ...previous.checkpoint, ...workout.checkpoint } };
  storeActive(account, workout);
  if (account && workout.sessionStart && workout.sets.every(s => 'schema_version' in s)) queueWorkout(account, { ...workout, phase: 'active' });
}
export function clearActiveWorkout(account: string | null, id: string) {
  if (readActiveWorkout(account)?.id === id) storeActive(account, null);
}
const restResults = new Map<string, ServerRestResult>();
export const readWorkoutSetResult = (account: string, id: string, index: number) => restResults.get(`${account}/${id}/${index}`) ?? null;
const workers = new Map<string, Promise<void>>();
export function syncWorkouts(account: string, request: ApiRequest): Promise<void> {
  const running = workers.get(account); if (running) return running;
  const worker = (async () => {
    let rejected: unknown = null;
    for (;;) {
      const next = read(account)[0]; if (!next || blocked.has(`${account}/${next.id}`)) { if (rejected) throw rejected; return; }
      function checkpoint() {
        const latest = read(account).find(p => p.id === next.id) ?? next;
        queueWorkout(account, { ...latest, checkpoint: next.checkpoint });
        const active = readActiveWorkout(account);
        if (active?.id === next.id) storeActive(account, { ...active, checkpoint: next.checkpoint });
      }
      try {
        if (!next.sessionStart && !next.checkpoint.sessionId) throw new WorkoutUploadError(400, 'Workout retained locally: its original inference mode is unavailable.');
        await uploadWorkout(request, next.checkpoint, next.sessionStart ?? { started_at: next.startedAt, device: 'phone', inference_mode: 'coreml' }, next.sets, checkpoint, {
          finalize: next.phase !== 'active', onSetResult: (index, result) => restResults.set(`${account}/${next.id}/${index}`, result),
        });
      } catch (error) {
        checkpoint();
        if (!isPermanentUploadFailure(error)) throw error;
        retainFailedWorkout(account, read(account).find(p => p.id === next.id) ?? next, error.status);
        write(account, read(account).filter(p => p.id !== next.id));
        rejected = error; continue;
      }
      if (next.checkpoint.result) saveWorkoutResult(account, next.id, next.checkpoint.result);
      // A new set or Finish can arrive while this upload is in flight. Keep that newer job.
      write(account, read(account).filter(p => p.id !== next.id || p.sets.length !== next.sets.length || p.phase !== next.phase));
    }
  })().finally(() => workers.delete(account));
  workers.set(account, worker); return worker;
}

const listeners = new Set<() => void>();
const resultKey = (account: string, id: string) => `workout-result:${encodeURIComponent(account)}:${id}`;
const resultCache = new Map<string, { raw: string | null | undefined; result: FinishResult | null }>();
export function readWorkoutResult(account: string, id: string): FinishResult | null {
 try { const k = resultKey(account, id), raw = Platform.OS === 'web' ? localStorage.getItem(k) : native().getString(k); const cached = resultCache.get(k); if (cached && cached.raw === raw) return cached.result; const result = readFinishResult(JSON.parse(raw ?? 'null')); resultCache.set(k, { raw, result }); return result; } catch { return null; }
}
function saveWorkoutResult(account: string, id: string, result: FinishResult) {
 const k = resultKey(account, id), data = JSON.stringify(result);
 if (Platform.OS === 'web') localStorage.setItem(k, data); else native().set(k, data);
 listeners.forEach(listener => listener());
}
export function subscribeWorkoutResults(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function workoutShared(account: string, id: string) { const k = `${resultKey(account, id)}:shared`; return Platform.OS === 'web' ? localStorage.getItem(k) === 'yes' : native().getString(k) === 'yes'; }
export function markWorkoutShared(account: string, id: string) { const k = `${resultKey(account, id)}:shared`; if (Platform.OS === 'web') localStorage.setItem(k, 'yes'); else native().set(k, 'yes'); }
