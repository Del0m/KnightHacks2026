import { PolishedPressable } from '@/components/PolishedPressable';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { AppPage, Action, ui } from '@/components/AppPage';
import { useTraining } from '@/state/Training';
import { colors as c } from '@/theme/tokens';
export default function BuddiesScreen() {
  const { profile, updateProfile } = useTraining(), [draftTime, setTime] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const time = draftTime ?? profile.buddyTime;
  return <AppPage title="Buddies"><Text style={ui.heading}>When do you usually train?</Text><View>{['Mornings', 'Afternoons', 'Evenings'].map(choice => <PolishedPressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: time === choice }} aria-checked={time === choice} onPress={() => { setTime(choice); setSaved(false); }} style={ui.row}><Text style={ui.rowTitle}>{choice}</Text><Text style={{ color: c.primary, fontSize: 22 }}>{time === choice ? '●' : '○'}</Text></PolishedPressable>)}</View>
    <Action onPress={() => { updateProfile({ buddyTime: time }); setSaved(true); }}>{saved ? 'Preference saved' : 'Save my training time'}</Action><View style={ui.empty}><Text style={ui.emptyTitle}>Buddy matching</Text><Text style={ui.muted}>Matching isn’t connected yet. Your training time is saved locally.</Text></View>
  </AppPage>;
}
