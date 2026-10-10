import { PolishedPressable } from '@/components/PolishedPressable';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { exercises, type Profile } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { colors as c } from '@/theme/tokens';
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export default function PlannerScreen() {
  const { profile, updateProfile } = useTraining(), [saved, setSaved] = useState(false);
  const [draftDays, setDays] = useState<number[] | null>(null), [draftFocus, setFocus] = useState<Profile['focus'] | null>(null);
  const days = draftDays ?? profile.days, focus = draftFocus ?? profile.focus;
  function changeDay(day: number) { setSaved(false); setDays(current => (current ?? profile.days).includes(day) ? (current ?? profile.days).filter(d => d !== day) : [...(current ?? profile.days), day]); }
  return <AppPage title="Plan">
    <Text style={ui.heading}>Your training days</Text><View style={{ flexDirection: 'row', gap: 5 }}>{[1, 2, 3, 4, 5, 6, 0].map(d => <PolishedPressable key={d} accessibilityRole="button" accessibilityState={{ selected: days.includes(d) }} aria-pressed={days.includes(d)} onPress={() => changeDay(d)} style={{ flex: 1, minHeight: 65, alignItems: 'center', justifyContent: 'center', gap: 9, borderBottomWidth: 3, borderColor: days.includes(d) ? c.primary : c.border }}><Text style={[ui.label, days.includes(d) && { color: c.primary }]}>{dayNames[d]}</Text><View style={{ height: 5, width: 5, borderRadius: 5, backgroundColor: days.includes(d) ? c.primary : c.border }} /></PolishedPressable>)}</View>
    <Text style={ui.heading}>What matters to you?</Text><View>{(['Stay consistent', 'Build strength'] as const).map(f => <PolishedPressable key={f} accessibilityRole="radio" accessibilityState={{ checked: focus === f }} aria-checked={focus === f} onPress={() => { setSaved(false); setFocus(f); }} style={ui.row}><Text style={ui.rowTitle}>{f}</Text><Text style={{ color: c.primary, fontSize: 22 }}>{focus === f ? '●' : '○'}</Text></PolishedPressable>)}</View>
    <Text style={ui.heading}>Your starting routine</Text><View>{exercises.map(e => <View key={e.id} style={ui.row}><View style={{ gap: 5 }}><Text style={ui.rowTitle}>{e.name}</Text><Text style={ui.muted}>{e.equipment}</Text></View><Text style={ui.text}>{e.sets} × {e.reps}</Text></View>)}</View>
    <Action disabled={!days.length} onPress={() => { updateProfile({ days, focus }); setSaved(true); }}>{saved ? 'Plan saved' : 'Save my week'}</Action><Text accessibilityLiveRegion="polite" style={ui.muted}>{saved ? 'Your training days and focus are saved on this device.' : 'Choose at least one day. This is a sample routine you can try at your own pace.'}</Text>
    <Action secondary onPress={() => router.navigate('/')}>View today’s workout</Action>
  </AppPage>;
}
