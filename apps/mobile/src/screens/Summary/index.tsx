import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { workoutPost } from './workoutPost';
import { colors, typography } from '@/theme/tokens';
import { useAuth } from '@/screens/Auth/session';
import { markWorkoutShared, readWorkoutResult, subscribeWorkoutResults, syncWorkouts, workoutShared } from '@/services/workoutQueue';
import type { WorkoutSet } from '@/services/workoutApi';
import { calendarDay, type Workout } from '@/data/workout';
import { MEDAL_LABEL } from '@/screens/LiveSet/restCardContent';
import { exerciseName, medalExplanation, phoneSummary } from './summary';
type Props = { onUndo?: () => void; workoutId: string; records: WorkoutSet[]; history: Workout[]; syncStatus: string };
export function WorkoutSummary(props: Props) {
 const { user } = useAuth();
 return <SummarySession key={`${user?.id ?? 'guest'}/${props.workoutId}`} {...props} />;
}
function SummarySession({ workoutId, records, history, syncStatus, onUndo }: Props) {
 const auth = useAuth(), account = auth.user?.id;
 const server = useSyncExternalStore(subscribeWorkoutResults, () => account ? readWorkoutResult(account, workoutId) : null, () => null);
 const [share, setShare] = useState(false), [shared, setShared] = useState(() => account ? workoutShared(account, workoutId) : false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
 const request = useRef(auth.apiFetch); useLayoutEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
 const live = useRef(true), lock = useRef(false);
 useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
 const [finishedAt] = useState(Date.now);
 const result = server ?? phoneSummary(records, history.filter(w => w.id !== workoutId), finishedAt);
 const medal = result.medal, measured = result.form_score !== null && !records.some(s => s.reps.some(r => r.flags.some(f => f.rule_id === 'manual_unscored')));
 async function publish() {
  if (!share || shared || lock.current || !account || !server) return;
  lock.current = true; setBusy(true); setError(null);
  try {
   const day = history.find(w => w.id === workoutId)?.day ?? calendarDay();
   const priorMeasured = history.some(w => w.id !== workoutId && finishedAt - Date.parse(w.finishedAt) <= 28 * 86400000 && Date.parse(w.finishedAt) < finishedAt && w.details?.length && w.details.every(s => s.goodReps !== undefined));
   const response = await request.current(`/sessions/${server.session_id}/share`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workoutPost(records, result, day, priorMeasured)) });
   if (!response.ok) throw new Error('Could not share your workout. Try again.');
   markWorkoutShared(account, workoutId);
   if (live.current) { setShared(true); setShare(false); }
  } catch (e) { if (live.current) setError(e instanceof Error ? e.message : 'Could not share your workout.'); }
  finally { lock.current = false; if (live.current) setBusy(false); }
 }
 return <AppPage title="Workout" intro="Workout complete">
  <View style={{ padding: 24, gap: 18, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: medal === 'gold' ? '#D4C080' : colors.border }}>
   <GlassSurface radius={28} colored tint={medal === 'gold' ? '#F6E8B7' : medal === 'silver' ? '#DFEAF0' : '#EEDACB'} />
   <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
    <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: colors[medal], alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: typography.display, fontSize: 38, color: colors[medal] }}>★</Text></View>
    <View style={{ flex: 1, gap: 4 }}><Text style={[ui.pageTitle, { marginTop: 0 }]}>{MEDAL_LABEL[medal]}</Text><Text style={ui.muted}>{measured ? medalExplanation(medal) : 'Workout complete. Manual reps aren’t scored.'}</Text></View>
   </View>
   <Text style={ui.heading}>{records.length} sets · {result.total_reps} reps</Text>
   {measured ? <><Text style={[ui.pageTitle, { marginTop: 0 }]}>{Math.round(result.form_score! * 100)}% form</Text><Text style={ui.muted}>{result.clean_reps} good reps · {Math.round(result.baseline_share * 100)}% 28-day average</Text><Text style={ui.text}>{Math.round((result.form_score! - result.baseline_share) * 100) >= 0 ? '+' : ''}{Math.round((result.form_score! - result.baseline_share) * 100)} percentage points vs average</Text></> : <Text style={ui.muted}>No measured form score for this workout.</Text>}
   {!server && measured && <Text style={ui.muted}>Phone result · {account ? 'account results appear after syncing.' : 'saved on this device.'}</Text>}
  </View>
  <Text style={ui.heading}>Personal records</Text>
  {server ? server.personal_records.length ? server.personal_records.map(pr => <View key={`${pr.exercise_id}/${pr.metric}`} style={ui.row}><View style={{ flex: 1 }}><Text style={ui.rowTitle}>{exerciseName(pr.exercise_id)}</Text><Text style={ui.muted}>{pr.metric === 'max_reps' ? 'Most reps in a set' : pr.metric === 'max_weight_kg' ? 'Heaviest weight' : 'Estimated one-rep max'}{pr.previous_value !== null ? ` · previous ${pr.previous_value}` : ' · first recorded best'}</Text></View><Text style={ui.rowTitle}>{pr.value}{pr.metric === 'max_reps' ? ' reps' : ' kg'}</Text></View>) : <Text style={ui.muted}>No new records this time.</Text> : <Text style={ui.muted}>{account ? 'Records will appear after account syncing.' : 'Log in to track account records.'}</Text>}
  <Text style={ui.muted}>{server ? 'Saved to your account.' : syncStatus}</Text>
  {account && !server && <Action secondary disabled={busy} onPress={() => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); void syncWorkouts(account, request.current).catch(() => { if (live.current) setError('Account sync is unavailable. Your workout is saved on this device.'); }).finally(() => { lock.current = false; if (live.current) setBusy(false); }); }}>Retry account sync</Action>}
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 12 }}><Text style={ui.rowTitle}>{shared ? 'Shared to feed' : 'Share to feed'}</Text><Switch accessibilityLabel="Share to feed" value={share} disabled={shared || busy || !account || !server} onValueChange={setShare} trackColor={{ false: '#D7E5ED', true: '#77BEA4' }} /></View>
  {!account && <Text style={ui.muted}>Your workout stays on this device. Log in to share.</Text>}
  {share && <Action tone="green" disabled={busy || shared} onPress={() => { void publish(); }}>{busy ? 'Sharing…' : 'Share workout'}</Action>}
  {error && <Text accessibilityRole="alert" style={ui.muted}>{error}</Text>}
  <Action onPress={() => router.replace('/')}>Back to Train</Action>
  <Action secondary onPress={() => router.replace('/me')}>View my history</Action>
  {onUndo && <Action secondary onPress={onUndo}>Undo save</Action>}
 </AppPage>;
}
