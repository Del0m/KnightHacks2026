import { Platform } from 'react-native';
import type { MMKV } from 'react-native-mmkv';
import { isPermanentUploadFailure, uploadWorkout, type ApiRequest, type UploadCheckpoint, type WorkoutSet } from './workoutApi';
type Pending = { id: string; startedAt: string; sets: WorkoutSet[]; checkpoint: UploadCheckpoint };
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
const workers = new Map<string, Promise<void>>();
export function syncWorkouts(account: string, request: ApiRequest): Promise<void> {
  const running = workers.get(account); if (running) return running;
  const worker = (async () => {
    let rejected: unknown = null;
    for (;;) {
      const next = read(account)[0]; if (!next || blocked.has(`${account}/${next.id}`)) { if (rejected) throw rejected; return; }
      try { await uploadWorkout(request, next.checkpoint, next.startedAt, next.sets, () => queueWorkout(account, next)); }
      catch (error) {
        if (!isPermanentUploadFailure(error)) { queueWorkout(account, next); throw error; }
        retainFailedWorkout(account, next, error.status);
        write(account, read(account).filter(p => p.id !== next.id));
        rejected = error; continue;
      }
      write(account, read(account).filter(p => p.id !== next.id));
    }
  })().finally(() => workers.delete(account));
  workers.set(account, worker); return worker;
}
