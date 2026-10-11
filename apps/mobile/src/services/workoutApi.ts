import type { SessionStart, SetRecord } from '../../../../specs/set-record/types';
import { readFinishResult, type FinishResult } from '@/screens/Summary/summary';
export type ApiRequest = (path: string, options?: RequestInit) => Promise<Response>;
export type UploadCheckpoint = { sessionId?: string; finished?: boolean; result?: FinishResult };
export type WorkoutSet = SetRecord | {
  exercise_id: string;
  weight_kg?: number | null;
  reps: { tempo_ms: number; range_deg: number; quality: number | null; clean?: boolean; flags: { rule_id: string; severity: string }[]; start_ms?: number | null; end_ms?: number | null }[];
  fps?: number | null;
  frames?: { t_ms: number; kp: number[] }[];
};

export class WorkoutUploadError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'WorkoutUploadError'; }
}
export function isPermanentUploadFailure(error: unknown): error is WorkoutUploadError {
  // Expired credentials and rate/timeout responses can recover without changing the workout.
  return error instanceof WorkoutUploadError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 409, 429].includes(error.status);
}

/** Stable set_index makes an interrupted save safe to resume on the same session. */
export async function uploadWorkout(api: ApiRequest, checkpoint: UploadCheckpoint, sessionStart: SessionStart, sets: WorkoutSet[], onCheckpoint: () => void = () => {}) {
  if (sets.some(set => !('schema_version' in set))) throw new WorkoutUploadError(400, 'Older or manual sets are retained on this device; they cannot be uploaded as measured pose data.');
  const request = timedRequest(api);
  async function post(path: string, body: object) {
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new WorkoutUploadError(response.status, 'Could not save your workout. Keep this screen open and try again.');
    return response.json();
  }
  if (checkpoint.finished) return;
  if (!checkpoint.sessionId) {
    const session = await post('/sessions', sessionStart);
    checkpoint.sessionId = session.id;
    onCheckpoint();
  }
  for (let i = 0; i < sets.length; i++) {
    const response = await request(`/sessions/${checkpoint.sessionId}/sets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sets[i]),
    });
    // This checkpoint owns the session and each index. 409 means this set already
    // committed, or the session finished before its response reached the phone.
    if (!response.ok && response.status !== 409) throw new WorkoutUploadError(response.status, 'Could not save your sets. Keep this screen open and try again.');
  }
  const response = await request(`/sessions/${checkpoint.sessionId}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  // The API returns 409 on a repeated finish after an earlier response was lost.
  if (!response.ok && response.status !== 409) throw new WorkoutUploadError(response.status, 'Could not finish your workout. Keep this screen open and try again.');
  const result = response.ok ? readFinishResult(await response.json()) : null;
  if (result) checkpoint.result = result;
  else {
    const recovered = await request(`/sessions/${checkpoint.sessionId}/summary`);
    const summary = recovered.ok ? readFinishResult(await recovered.json()) : null;
    if (!summary) throw new Error('Your workout is saved. Account results will retry.');
    checkpoint.result = summary;
  }
  checkpoint.finished = true;
  onCheckpoint();
}

/** One rest-time round trip, without finishing the workout. Duplicate indices retain the phone note. */
export async function uploadLiveSet(api: ApiRequest, checkpoint: UploadCheckpoint, sessionStart: SessionStart, set: SetRecord) {
  const request = timedRequest(api);
  if (!checkpoint.sessionId) {
    const response = await request('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sessionStart) });
    if (!response.ok) throw new Error('Set saved on this device. Server sync will retry.');
    const session = await response.json();
    if (typeof session.id !== 'string') throw new Error('Could not confirm the workout session.');
    checkpoint.sessionId = session.id;
  }
  const response = await request(`/sessions/${checkpoint.sessionId}/sets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(set) });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error('Set saved on this device. Server sync will retry.');
  const result = await response.json();
  // Only a validated rest result can replace the immediate phone feedback.
  if (!['gold', 'silver', 'bronze'].includes(result.score?.medal) || !['phone', 'databricks'].includes(result.score?.source) || typeof result.rest_note?.text !== 'string' || !['fixed', 'llm'].includes(result.rest_note?.source)) return null;
  return result as import('@/screens/LiveSet/restCardContent').ServerRestResult;
}

function timedRequest(request: ApiRequest): ApiRequest {
  return async (path, options) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try { return await request(path, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  };
}
