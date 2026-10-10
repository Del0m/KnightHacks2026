import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { pageColors } from '@/theme/tokens';
import { useTraining } from '@/state/Training';
const c = pageColors('Feed'), ui = pageStyles('Feed');
export default function FeedScreen() {
  const { workouts, profile } = useTraining();
  return <AppPage title="Feed">
    {!workouts.length ? <View style={ui.empty}><Text style={ui.emptyTitle}>Your activity</Text><Text style={ui.muted}>No completed workouts yet. Finish a session to add it here.</Text><Action onPress={() => router.navigate('/')}>Find today’s workout</Action></View> : <View>{workouts.map(w => <View key={w.id} style={[ui.row, { alignItems: 'flex-start' }]}><View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.rowTitle}>{profile.name.slice(0, 1).toUpperCase() || 'Y'}</Text></View><View style={{ flex: 1, gap: 7 }}><Text style={ui.rowTitle}>{profile.name || 'You'} finished a workout</Text><Text style={ui.text}>{w.sets} sets · {w.reps} reps</Text><Text style={ui.muted}>{new Date(w.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Personal activity</Text></View></View>)}</View>}
    <Text style={[ui.muted, { fontSize: 13 }]}>Your activity is stored on this device. Nothing is posted publicly.</Text>
  </AppPage>;
}
