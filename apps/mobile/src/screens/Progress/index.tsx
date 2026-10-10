import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppPage, Action, ui } from '@/components/AppPage';
import { Streak } from '@/components/Streak';
import { streak } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { useAuth } from '@/screens/Auth/session';
export default function ProgressScreen() {
  const { profile, updateProfile, workouts } = useTraining(), [draftName, setName] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const auth = useAuth(), [logoutError, setLogoutError] = useState<string | null>(null), [loggingOut, setLoggingOut] = useState(false);
  const name = draftName ?? (profile.name || auth.user?.name || '');
  return <AppPage title="Me"><Streak days={streak(workouts)} /><Text style={ui.label}>What should we call you?</Text><TextInput accessibilityLabel="Your name" value={name} maxLength={40} onChangeText={value => { setName(value); setSaved(false); }} placeholder="Your name" placeholderTextColor="#688494" style={ui.input} /><Action onPress={() => { updateProfile({ name: name.trim() }); setSaved(true); }}>{saved ? 'Name saved' : 'Save name'}</Action>
    <Text style={ui.heading}>Your workout history</Text>{!workouts.length ? <View style={ui.empty}><Text style={ui.emptyTitle}>No workouts yet</Text><Text style={ui.muted}>Completed workouts appear here.</Text></View> : workouts.map(w => <View key={w.id} style={ui.row}><View style={{ gap: 5 }}><Text style={ui.rowTitle}>{new Date(w.finishedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</Text><Text style={ui.muted}>{w.sets} sets · {w.reps} reps · manually tracked</Text></View><Text style={ui.label}>{w.minutes} min</Text></View>)}
    <Text style={ui.heading}>Account</Text><Text style={ui.muted}>{auth.user?.email}</Text>
    {logoutError && <Text accessibilityRole="alert" style={ui.text}>{logoutError}</Text>}
    <Action secondary disabled={loggingOut} onPress={() => { setLoggingOut(true); setLogoutError(null); void auth.logout().catch(error => setLogoutError(error.message)).finally(() => setLoggingOut(false)); }}>{loggingOut ? 'Logging out…' : 'Log out'}</Action>
    <Text style={ui.heading}>Private by default</Text><Text style={ui.muted}>Workout history and preferences stay separate for each account on this browser. Cloud workout sync is not connected yet.</Text>
  </AppPage>;
}
