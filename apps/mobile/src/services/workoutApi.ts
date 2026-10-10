export type ApiRequest = (path: string, options?: RequestInit) => Promise<Response>;
export type UploadCheckpoint = { sessionId?: string; finished?: boolean };
export type WorkoutSet = {
  exercise_id: string;
  weight_kg?: number | null;
  reps: { tempo_ms: number; range_deg: number; quality: number | null; flags: { rule_id: string; severity: string }[]; start_ms?: number; end_ms?: number }[];
  fps?: number;
  frames?: { t_ms: number; kp: number[] }[];
};

/** Stable set_index makes an interrupted save safe to resume on the same session. */
export async function uploadWorkout(request: ApiRequest, checkpoint: UploadCheckpoint, startedAt: string, sets: WorkoutSet[]) {
  async function post(path: string, body: object) {
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Could not save your workout. Keep this screen open and try again.');
    return response.json();
  }
  if (checkpoint.finished) return;
  if (!checkpoint.sessionId) {
    const session = await post('/sessions', { started_at: startedAt, device: 'phone', inference_mode: 'on_device' });
    checkpoint.sessionId = session.id;
  }
  for (let i = 0; i < sets.length; i++) {
    const response = await request(`/sessions/${checkpoint.sessionId}/sets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sets[i], set_index: i }),
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
