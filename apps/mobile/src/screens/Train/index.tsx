import { PolishedPressable } from '@/components/PolishedPressable';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { BodyPreview } from '@/components/BodyPreview';
import { Streak } from '@/components/Streak';
import { exercises, streak, type ExerciseId } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { colors as c, typography as t } from '@/theme/tokens';
export default function TrainScreen() {
  const { workouts } = useTraining(), reduced = useReducedMotion();
  const [selected, setSelected] = useState<ExerciseId | null>(exercises[0].id), [playing, setPlaying] = useState(false);
  const navigation = useNavigation<{ addListener(event: 'tabPress', listener: () => void): () => void }>();
  const resetPreview = useCallback(() => { setSelected(exercises[0].id); setPlaying(false); }, []);
  useFocusEffect(resetPreview);
  useEffect(() => navigation.addListener('tabPress', resetPreview), [navigation, resetPreview]);
  function select(id: ExerciseId) { setSelected(selected === id ? null : id); setPlaying(selected !== id && reduced === false); }
  return <AppPage compact><Streak days={streak(workouts)} />
    <View style={styles.separator} />
    <View style={{ position: 'relative' }}>
      <BodyPreview selected={selected} playing={playing} height={320} />
      <PolishedPressable testID="glass-playback" accessibilityRole="button" accessibilityLabel={playing ? 'Pause movement' : 'Play movement'} accessibilityHint={selected ? 'Toggle the exercise demonstration' : 'Select an exercise first'} disabled={!selected} onPress={() => setPlaying(p => !p)} style={({ pressed }) => [styles.playback, { opacity: selected ? pressed ? .75 : 1 : .55, transform: [{ scale: pressed ? .97 : 1 }] }]}>
        {playing ? <View style={{ flexDirection: 'row', gap: 3 }}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <View style={styles.playTriangle} />}
        <Text style={styles.play}>{playing ? 'Pause' : 'Play'}</Text>
      </PolishedPressable>
    </View>
    <View style={styles.separator} />
    <Text accessibilityRole="header" style={styles.agenda}>Todays agenda: <Text style={{ color: c.muted }}>Full body</Text></Text>
    <View>{exercises.map((e, i) => <PolishedPressable key={e.id} testID={`exercise-${e.id}`} accessibilityRole="button" aria-pressed={selected === e.id} accessibilityHint="Select to focus and animate. Select again to zoom out." onPress={() => select(e.id)} style={({ pressed }) => [styles.row, { backgroundColor: selected === e.id || pressed ? 'rgba(255,255,255,0.65)' : 'transparent' }]}>
      <Text style={[styles.number, selected === e.id && { color: c.primary }]}>{orderLabel(i + 1)}</Text>
      <Text style={[styles.name, selected === e.id && { color: c.primary }]}>{e.name}</Text>
      <View style={styles.details}><Text style={styles.reps}>{e.sets} × {e.reps} reps</Text><Text style={styles.detail}>{e.muscles}</Text></View>
    </PolishedPressable>)}</View>
    <Action onPress={() => router.push('/workout')}>Begin Workout</Action>
    <Text style={[ui.muted, { textAlign: 'center', fontSize: 12 }]}>Sample routine · workout days build your streak</Text>
  </AppPage>;
}
const styles = StyleSheet.create({
  separator: { height: 1, backgroundColor: '#CAD5DC' },
  agenda: { fontFamily: t.label, fontSize: 20, color: c.text, marginTop: 4 },
  row: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: '#D2DEE5', paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  number: { width: 28, fontFamily: t.family, fontSize: 13, color: c.muted },
  name: { flex: 1, fontFamily: t.label, fontSize: 17, color: c.text },
  details: { alignItems: 'flex-end', gap: 2 }, reps: { fontFamily: t.label, fontSize: 13, color: c.text }, detail: { fontFamily: t.family, fontSize: 12, color: c.muted, textAlign: 'right' },
  playback: { position: 'absolute', left: 0, bottom: 12, minHeight: 40, paddingHorizontal: 15, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 14px rgba(49,92,120,0.12)' },
  play: { color: c.text, fontFamily: t.label, fontSize: 14 }, pauseBar: { width: 3, height: 12, borderRadius: 1, backgroundColor: c.text }, playTriangle: { width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderLeftWidth: 9, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c.text },
});

const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });
function orderLabel(number: number) {
  const rule = ordinalRules.select(number);
  return `${number}${rule === 'one' ? 'st' : rule === 'two' ? 'nd' : rule === 'few' ? 'rd' : 'th'}`;
}
