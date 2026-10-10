import { PolishedPressable } from '@/components/PolishedPressable';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { BodyPreview } from '@/components/BodyPreview';
import { ExerciseMenu } from '@/components/ExerciseMenu';
import { ExerciseTabs, type ExerciseTab } from '@/components/ExerciseTabs';
import { RotationSlider } from '@/components/RotationSlider';
import { Streak } from '@/components/Streak';
import { exercises, practiceExercises, streak, completedToday, type ExerciseId } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cameraSpec } from '@/screens/LiveSet/exercises';
import { colors as c, typography as t } from '@/theme/tokens';
export default function TrainScreen() {
  const { workouts } = useTraining(), reduced = useReducedMotion();
  const [selected, setSelected] = useState<ExerciseId | null>(exercises[0].id), [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState<ExerciseId | null>(null), [rotation, setRotation] = useState(0), [section, setSection] = useState<ExerciseTab>('workout');
  const navigation = useNavigation<{ addListener(event: 'tabPress', listener: () => void): () => void }>();
  const resetPreview = useCallback(() => { setSelected(exercises[0].id); setRotation(0); setExpanded(null); setPlaying(reduced === false); }, [reduced]);
  useFocusEffect(resetPreview);
  useEffect(() => navigation.addListener('tabPress', resetPreview), [navigation, resetPreview]);
  function select(id: ExerciseId) { setExpanded(current => current === id ? null : id); if (selected === id) return; setSelected(id); setRotation(0); setPlaying(reduced === false); }
  const practice = (id: ExerciseId) => router.push({ pathname: '/practice', params: { exercise: id } });
  const menu = (id: ExerciseId) => <ExerciseMenu open={expanded === id} onPractice={() => practice(id)} />;
  return <AppPage compact><Streak days={streak(workouts)} />
    <View style={styles.separator} />
    <View style={{ position: 'relative' }}>
      <BodyPreview selected={selected} playing={playing} height={320} rotation={rotation} />
      <PolishedPressable testID="glass-playback" accessibilityRole="button" accessibilityLabel={playing ? 'Pause movement' : 'Play movement'} accessibilityHint={selected ? 'Toggle the exercise demonstration' : 'Select an exercise first'} disabled={!selected} onPress={() => setPlaying(p => !p)} style={({ pressed }) => [styles.playback, { opacity: selected ? pressed ? .75 : 1 : .55, transform: [{ scale: pressed ? .97 : 1 }] }]}>
        {playing ? <View style={{ flexDirection: 'row', gap: 3 }}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <View style={styles.playTriangle} />}
        <Text style={styles.play}>{playing ? 'Pause' : 'Play'}</Text>
      </PolishedPressable>
    </View>
    <RotationSlider value={rotation} onChange={setRotation} />
    <View style={styles.separator} />
    <ExerciseTabs value={section} onChange={setSection} />
    {section === 'workout' ? <>
    <Text accessibilityRole="header" style={styles.agenda}>Full body</Text>
    <View>{exercises.map((e, i) => <View key={e.id}><PolishedPressable testID={`exercise-${e.id}`} accessibilityRole="button" accessibilityState={{ selected: selected === e.id, expanded: expanded === e.id }} accessibilityHint="Show demonstration and practice options." onPress={() => select(e.id)} style={({ pressed }) => [styles.row, { backgroundColor: selected === e.id || pressed ? 'rgba(255,255,255,0.65)' : 'transparent' }]}>
      <Text style={[styles.number, selected === e.id && { color: c.primary }]}>{orderLabel(i + 1)}</Text>
      <Text style={[styles.name, selected === e.id && { color: c.primary }]}>{e.name}</Text>
      <View style={styles.details}><Text style={styles.reps}>{e.sets} × {e.reps} reps</Text><Text style={styles.detail}>{e.muscles}</Text></View><View style={styles.completion}>{completedToday(workouts, cameraSpec(e.id).id, e.sets) && <Text accessibilityLabel={`${e.name} completed`} style={{ color: c.primary, fontSize: 20 }}>✓</Text>}</View>
    </PolishedPressable>{menu(e.id)}</View>)}</View>
    <Action onPress={() => router.push({ pathname: '/camera-setup', params: { exercise: exercises[0].id } })}>Begin Workout</Action>
    </> : <>
    <View>{practiceExercises.map(e => <View key={e.id}><PolishedPressable testID={`practice-exercise-${e.id}`} accessibilityRole="button" accessibilityState={{ selected: selected === e.id, expanded: expanded === e.id }} onPress={() => select(e.id)} style={[styles.row, selected === e.id && { backgroundColor: 'rgba(255,255,255,.65)' }]}><Text style={styles.name}>{e.name}</Text><Text style={styles.detail}>{e.muscles}</Text></PolishedPressable>{menu(e.id)}</View>)}</View></>}
    <PolishedPressable accessibilityRole="button" onPress={() => router.push('/onboarding')} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.muted}>Set goals & workout days</Text></PolishedPressable>
    <Text style={[ui.muted, { textAlign: 'center', fontSize: 12 }]}>Sample full-body routine</Text>
  </AppPage>;
}
const styles = StyleSheet.create({
  separator: { height: 1, backgroundColor: '#CAD5DC' },
  agenda: { fontFamily: t.label, fontSize: 20, color: c.text, marginTop: 4 },
  row: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: '#D2DEE5', paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 12 },
  completion: { width: 22, alignItems: 'flex-end', justifyContent: 'center' },
  number: { width: 28, fontFamily: t.family, fontSize: 13, color: c.muted },
  name: { flex: 1, fontFamily: t.label, fontSize: 17, color: c.text },
  details: { alignItems: 'flex-end', gap: 2 }, reps: { fontFamily: t.label, fontSize: 13, color: c.text }, detail: { fontFamily: t.family, fontSize: 12, color: c.muted, textAlign: 'right' },
  playback: { position: 'absolute', left: 0, top: 12, minHeight: 40, paddingHorizontal: 15, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 14px rgba(49,92,120,0.12)' },
  play: { color: c.text, fontFamily: t.label, fontSize: 14 }, pauseBar: { width: 3, height: 12, borderRadius: 1, backgroundColor: c.text }, playTriangle: { width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderLeftWidth: 9, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c.text },
});

// English ordinals by hand: Hermes on iOS has no Intl.PluralRules, so constructing one crashes at launch.
export function orderLabel(number: number) {
  const tens = number % 100;
  const ones = number % 10;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${number}${suffix}`;
}
