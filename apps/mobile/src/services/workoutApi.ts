import type { SessionStart, SetRecord } from '../../../../specs/set-record/types';

export type ApiRequest = (path: string, options?: RequestInit) => Promise<Response>;
export type UploadCheckpoint = { sessionId?: string; finished?: boolean };
export type WorkoutSet = SetRecord;

/** Stable set_index makes an interrupted save safe to resume on the same session. */
export async function uploadWorkout(request: ApiRequest, checkpoint: UploadCheckpoint, sessionStart: SessionStart, sets: WorkoutSet[]) {
  async function post(path: string, body: object) {
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Could not save your workout. Keep this screen open and try again.');
    return response.json();
  }
  if (checkpoint.finished) return;
  if (!checkpoint.sessionId) {
    const session = await post('/sessions', sessionStart);
    checkpoint.sessionId = session.id;
  }
  for (const set of sets) {
    const response = await request(`/sessions/${checkpoint.sessionId}/sets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(set),
    });
    // This checkpoint owns the session and each index. 409 means this set already
    // committed, or the session finished before its response reached the phone.
    if (!response.ok && response.status !== 409) throw new Error('Could not save your sets. Keep this screen open and try again.');
  }
  const response = await request(`/sessions/${checkpoint.sessionId}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  // The API returns 409 on a repeated finish after an earlier response was lost.
  if (!response.ok && response.status !== 409) throw new Error('Could not finish your workout. Keep this screen open and try again.');
  checkpoint.finished = true;
}
