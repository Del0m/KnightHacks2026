import { PolishedPressable } from '@/components/PolishedPressable';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { BodyPreview } from '@/components/BodyPreview';
import { exercises } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { colors as c } from '@/theme/tokens';
export default function WorkoutEntry() {
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  return setup === 'done' ? <WorkoutScreen /> : <Redirect href="/camera-setup" />;
}
function WorkoutScreen() {
  const { finish, removeWorkout } = useTraining(), started = useRef(0), recorded = useRef(false), savedId = useRef<string | null>(null);
  const [sets, setSets] = useState<number[]>([]), [reps, setReps] = useState(String(exercises[0].reps)), [rest, setRest] = useState(0), [done, setDone] = useState(false), [playing, setPlaying] = useState(false);
  useEffect(() => { started.current = Date.now(); }, []);
  const total = exercises.reduce((sum, e) => sum + e.sets, 0), current = exercises[Math.min(Math.floor(sets.length / 3), exercises.length - 1)], resting = rest > 0, finished = sets.length === total;
  useEffect(() => { if (!resting) return; const end = Date.now() + 45 * 1000; const timer = setInterval(() => setRest(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250); return () => clearInterval(timer); }, [resting]);
  const entered = Number(reps), valid = Number.isInteger(entered) && entered > 0 && entered <= 100;
  function completeSet() { if (!valid || resting || finished) return; const count = sets.length + 1; setSets(s => [...s, entered]); if (count < total) { setRest(45); setReps(String(exercises[Math.floor(count / 3)].reps)); } setPlaying(false); }
  function save() { if (recorded.current) return; recorded.current = true; savedId.current = finish(sets.length, sets.reduce((a, b) => a + b, 0), Math.max(1, Math.round((Date.now() - started.current) / 60000))); setDone(true); }
  if (done) return <AppPage title="Workout" intro="You showed up."><Text style={ui.text}>Workout saved.</Text><Text style={ui.muted}>{sets.length} sets and {sets.reduce((a, b) => a + b, 0)} reps, at your own pace.</Text><Action onPress={() => router.replace('/')}>Back to Train</Action><Action secondary onPress={() => router.replace('/me')}>View my history</Action><PolishedPressable accessibilityRole="button" onPress={() => { if (savedId.current) removeWorkout(savedId.current); savedId.current = null; recorded.current = false; setDone(false); }}><Text style={[ui.muted, { textAlign: 'center', padding: 12 }]}>Undo save</Text></PolishedPressable></AppPage>;
  if (finished) return <AppPage title="Workout" intro="Your session is complete."><Text style={ui.muted}>You’ve marked all {total} sets complete. Save this workout to your history and streak.</Text><Action onPress={save}>Finish Workout</Action><Action secondary onPress={() => router.back()}>Leave without saving</Action></AppPage>;
  return <AppPage title="Workout"><PolishedPressable accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: c.primary }}>← Back to Train</Text></PolishedPressable><Text style={ui.muted}>Manual tracking · {sets.length} of {total} sets complete</Text>
    <View style={{ height: 3, backgroundColor: c.border }}><View style={{ height: 3, width: `${sets.length / total * 100}%`, backgroundColor: c.primary }} /></View><Text style={ui.pageTitle}>{current.name}</Text><Text style={ui.muted}>Set {sets.length % 3 + 1} of {current.sets} · aim for {current.reps} reps</Text><BodyPreview selected={current.id} playing={playing} />
    {resting ? <View style={{ gap: 12 }}><Text style={ui.heading}>Take a breath.</Text><Text accessibilityLiveRegion="none" style={[ui.pageTitle, { fontSize: 42 }]}>{rest}s</Text><Action secondary onPress={() => setRest(0)}>Skip rest</Action></View> : <View style={{ gap: 10 }}><PolishedPressable accessibilityRole="button" onPress={() => setPlaying(p => !p)}><Text style={{ color: c.primary, paddingVertical: 8 }}>{playing ? 'Pause demonstration' : 'Play demonstration'}</Text></PolishedPressable><Text style={ui.label}>Reps you completed</Text><TextInput accessibilityLabel="Reps you completed" keyboardType="number-pad" inputMode="numeric" value={reps} onChangeText={setReps} style={ui.input} maxLength={3} /><Action disabled={!valid} onPress={completeSet}>Mark set complete</Action></View>}
    <Action secondary onPress={() => router.push({ pathname: '/camera-setup', params: { exercise: current.id, returnTo: 'workout' } })}>Check camera placement</Action>
    <Text style={[ui.muted, { fontSize: 13 }]}>You record your own reps here. Camera placement is available; live coaching comes next.</Text>
  </AppPage>;
}
