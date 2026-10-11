import type { SessionStart } from '../../../../specs/set-record/types';
import { WorkoutSummary } from '@/screens/Summary';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { BodyPreview } from '@/components/BodyPreview';
import { exercises } from '@/data/workout';
import { useAuth } from '@/screens/Auth/session';
import { isPermanentUploadFailure, uploadLiveSet, type UploadCheckpoint, type WorkoutSet } from '@/services/workoutApi';
import { queueWorkout, syncWorkouts } from '@/services/workoutQueue';
import { useTraining } from '@/state/Training';
import WorkoutCamera from '@/screens/LiveSet/WorkoutCamera';
import { cameraSpec } from '@/screens/LiveSet/exercises';
import { RestCard, useServerRestResult } from '@/screens/LiveSet/RestCard';
import { type SetFeedback } from '@/screens/LiveSet/setRecord';
import type { ServerRestResult } from '@/screens/LiveSet/restCardContent';
export default function WorkoutEntry() {
  const { setup, mode, exercise, cameraPosition } = useLocalSearchParams<{ setup?: string; mode?: string; exercise?: string; cameraPosition?: 'front' | 'back' }>();
  return setup === 'done' ? <WorkoutScreen mode={mode} exercise={exercise} cameraPosition={cameraPosition} /> : <Redirect href="/camera-setup" />;
}
function WorkoutScreen({ mode, exercise, cameraPosition }: { mode?: string; exercise?: string; cameraPosition?: 'front' | 'back' }) {
  const auth = useAuth(), owner = useRef(auth.user?.id), checkpoint = useRef<UploadCheckpoint>({}), started = useRef(new Date().toISOString()), recorded = useRef(false);
  const { finish, workouts, removeWorkout } = useTraining();
  const sessionStart = useRef<SessionStart | null>(null);
  const [records, setRecords] = useState<WorkoutSet[]>([]), [feedbacks, setFeedbacks] = useState<(SetFeedback | null)[]>([]);
  const [manual, setManual] = useState(mode === 'manual' || Platform.OS !== 'ios'), [reps, setReps] = useState(cameraSpec(exercise).id === 'bicep_curl' ? '12' : '10');
  const [restUntil, setRestUntil] = useState(0), [now, setNow] = useState(Date.now), [done, setDone] = useState(false), [playing, setPlaying] = useState(false), [syncStatus, setSyncStatus] = useState('Saved on this device.'), [workoutId, setWorkoutId] = useState('');
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const [restRequest, setRestRequest] = useState<Promise<ServerRestResult | null> | null>(null);
  const requests = useRef<Promise<unknown>>(Promise.resolve()), reachable = useRef(true);
  const selected = cameraSpec(exercise);
  const selectedIndex = exercises.findIndex(e => cameraSpec(e.id).id === selected.id);
  const ordered = selectedIndex < 0 ? [{ id: selected.id, name: selected.name, sets: 3, reps: 10 }] : [...exercises.slice(selectedIndex), ...exercises.slice(0, selectedIndex)];
  const plan = ordered.flatMap(item => Array.from({ length: item.sets }, (_, set) => ({ ...item, set: set + 1 })));
  const current = plan[Math.min(records.length, plan.length - 1)], spec = cameraSpec(current.id), finished = records.length === plan.length;
  const resting = restUntil > now;
  useEffect(() => { if (!restUntil) return; const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= restUntil) { setRestUntil(0); setRestRequest(null); } }, 250); return () => clearInterval(timer); }, [restUntil]);
  const measuredHistory = workouts.filter(w => now - Date.parse(w.finishedAt) <= 28 * 86400000).flatMap(w => w.details ?? []).filter(s => s.goodReps !== undefined && s.reps > 0);
  const baseline = measuredHistory.length ? measuredHistory.reduce((n, s) => n + s.goodReps! / s.reps, 0) / measuredHistory.length : .7;
  const server = useServerRestResult(restRequest, resting);
  const last = feedbacks[feedbacks.length - 1];
  const entered = Number(reps), valid = Number.isInteger(entered) && entered > 0 && entered <= 100;
  function completeSet(record: WorkoutSet, feedback: SetFeedback | null, inferenceMode?: SessionStart['inference_mode']) {
    completingRef.current = false; setCompleting(false);
    if (resting || finished) return;
    const index = records.length;
    setReps(String(plan[index + 1]?.reps ?? current.reps));
    setRecords(previous => [...previous, record]); setFeedbacks(previous => [...previous, feedback]); setPlaying(false);
    setNow(Date.now()); setRestUntil(Date.now() + 45000);
    setRestRequest(null);
    if (owner.current && auth.user?.id === owner.current && inferenceMode && 'schema_version' in record) {
      sessionStart.current ??= { started_at: started.current, device: 'phone', inference_mode: inferenceMode };
      const account = owner.current;
      const request = requests.current.then(async () => {
        if (!reachable.current || auth.user?.id !== account) return null;
        try { return await uploadLiveSet(auth.apiFetch, checkpoint.current, sessionStart.current!, record); }
        catch { reachable.current = false; return null; }
      });
      requests.current = request; setRestRequest(request);
    }
  }
  function manualSet() { if (valid) completeSet({ exercise_id: spec.id, reps: Array.from({ length: entered }, () => ({ tempo_ms: 0, range_deg: 0, quality: null, flags: [{ rule_id: 'manual_unscored', severity: 'info' }] })) }, null); }
  function save() {
    if (recorded.current) return;
    recorded.current = true;
    const id = finish(records.length, records.reduce((n, s) => n + s.reps.length, 0), Math.max(1, Math.round((Date.now() - Date.parse(started.current)) / 60000)), records.map((record, i) => ({ exercise_id: record.exercise_id, reps: record.reps.length, ...(feedbacks[i] ? { goodReps: feedbacks[i]!.cleanReps, medal: feedbacks[i]!.medal, note: feedbacks[i]!.note } : {}) })));
    setWorkoutId(id); setDone(true);
    const account = owner.current;
    if (account && auth.user?.id === account && sessionStart.current && records.every(r => 'schema_version' in r)) {
      setSyncStatus('Saved on this device. Syncing…');
      queueWorkout(account, { id, startedAt: started.current, sets: records, sessionStart: sessionStart.current, checkpoint: checkpoint.current }, requests.current);
      void requests.current.then(() => syncWorkouts(account, auth.apiFetch)).then(() => setSyncStatus('Saved to your account.')).catch(error => setSyncStatus(isPermanentUploadFailure(error) ? 'Saved on this device. Account sync needs attention.' : 'Saved on this device. Account sync will retry.'));
    }
  }
  function leave() { if (completingRef.current) return; if (records.length) save(); router.replace('/'); }
  const exit = <Action secondary disabled={completing} onPress={leave}>Back to Train</Action>;
  if (owner.current !== auth.user?.id) return <AppPage title="Workout"><Text style={ui.muted}>Your account changed. Start a new workout to keep its history separate.</Text><Action onPress={() => router.replace('/')}>Back to Train</Action></AppPage>;
  if (done) return <WorkoutSummary workoutId={workoutId} records={records} history={workouts} syncStatus={syncStatus} onUndo={records.some(r => !('schema_version' in r)) ? () => { removeWorkout(workoutId); recorded.current = false; setRestUntil(0); setRestRequest(null); setDone(false); } : undefined} />;
  if (resting) return <AppPage headerAction={exit} title="Workout" intro={finished ? 'Last set complete' : 'Rest'}>{last ? <RestCard phone={last} server={server} secondsLeft={Math.ceil((restUntil - now) / 1000)} /> : <View style={{ gap: 12 }}><Text style={ui.heading}>{records[records.length - 1].reps.length} reps logged</Text><Text style={ui.pageTitle}>{Math.ceil((restUntil - now) / 1000)}s</Text><Text style={ui.muted}>Manual tracking has no measured form score.</Text></View>}{!finished && <><Text style={ui.muted}>Next: {current.name} · set {current.set} of {current.sets}</Text><Text style={ui.muted}>The next set starts when rest ends.</Text></>}<Action onPress={() => { if (finished) save(); else { setRestUntil(0); setRestRequest(null); } }}>{finished ? 'Finish Workout' : 'Start next set now'}</Action></AppPage>;
  if (finished) return <AppPage headerAction={exit} title="Workout" intro="Session complete">{last && <RestCard phone={last} server={null} />}<Action onPress={save}>Finish Workout</Action></AppPage>;
  return <AppPage headerAction={exit} title="Workout"><Text style={ui.muted}>{records.length} of {plan.length} sets complete</Text><Text style={ui.pageTitle}>{current.name}</Text><Text style={ui.muted}>Set {current.set} of {current.sets} · aim for {current.reps} reps</Text>
    {manual ? <View style={{ gap: 12 }}><BodyPreview selected={spec.id === 'bicep_curl' ? 'curl' : spec.id === 'shoulder_press' ? 'press' : spec.id === 'squat' ? 'squat' : null} playing={playing} /><Action secondary onPress={() => setPlaying(p => !p)}>{playing ? 'Pause demonstration' : 'Play demonstration'}</Action><Text style={ui.label}>Reps you completed</Text><TextInput accessibilityLabel="Reps you completed" keyboardType="number-pad" value={reps} onChangeText={setReps} style={ui.input} maxLength={3} /><Action disabled={!valid} onPress={manualSet}>Log set</Action>{Platform.OS === 'ios' && <Action secondary onPress={() => setManual(false)}>Use camera tracking</Action>}</View> : <WorkoutCamera key={records.length} spec={spec} setIndex={records.length} initialPosition={cameraPosition} baseline={baseline} onFinishing={() => { completingRef.current = true; setCompleting(true); }} onComplete={completeSet} onManual={() => setManual(true)} />}
  </AppPage>;
}
