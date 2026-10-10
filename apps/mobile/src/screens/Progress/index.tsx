import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { PolishedPressable } from '@/components/PolishedPressable';
import { Streak } from '@/components/Streak';
import { calendarDay, streak } from '@/data/workout';
import { useTraining } from '@/state/Training';
import { useAuth } from '@/screens/Auth/session';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { pageColors, typography as t, tabAccents } from '@/theme/tokens';
import { monthCells } from './calendar';

const rose = tabAccents[4].color;
const sections = ['Calendar', 'Videos', 'PBs'] as const;
const sectionIcons = [
  { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  { ios: 'play.rectangle', android: 'video_library', web: 'video_library' },
  { ios: 'trophy', android: 'emoji_events', web: 'emoji_events' },
] as const;
const sectionColors = [tabAccents[0].color, tabAccents[2].color, tabAccents[4].color];
const c = pageColors('Me'), ui = pageStyles('Me');
export default function ProgressScreen() {
  const { profile, updateProfile, workouts } = useTraining(), auth = useAuth();
  const [editing, setEditing] = useState(false), [name, setName] = useState(''), [bio, setBio] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false), [error, setError] = useState<string | null>(null), [loggingOut, setLoggingOut] = useState(false);
  const [section, setSection] = useState(0), [tabWidth, setTabWidth] = useState(0), [slide] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();
  const displayName = profile.name || auth.user?.name || 'Your name';
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  useEffect(() => {
    const target = section * tabWidth / 3;
    if (reduced !== false) { slide.setValue(target); return; }
    const animation = Animated.timing(slide, { toValue: target, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(); return () => animation.stop();
  }, [section, tabWidth, reduced, slide]);
  async function pickPhoto() {
    if (photoBusy) return;
    setPhotoBusy(true); setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
      if (result.canceled) return;
      const asset = result.assets[0], type = asset.mimeType ?? 'image/jpeg';
      if (!asset.base64 || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Choose a JPG, PNG, or WebP photo.');
      if (asset.base64.length > 2700000) throw new Error('Choose a smaller photo (under 2 MB).');
      updateProfile({ avatar: `data:${type};base64,${asset.base64}` });
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open your photos.'); }
    finally { setPhotoBusy(false); }
  }
  function edit() { setName(displayName === 'Your name' ? '' : displayName); setBio(profile.bio); setEditing(true); }
  return <AppPage title="Me">
    <View style={styles.profile}>
      <View style={styles.identity}>
        <PolishedPressable accessibilityRole="button" accessibilityLabel="Change profile picture" disabled={photoBusy} onPress={() => { void pickPhoto(); }} style={styles.avatar}>
          {photoBusy ? <ActivityIndicator color={rose} /> : profile.avatar ? <Image accessibilityLabel="Your profile picture" source={{ uri: profile.avatar }} style={styles.photo} /> : <Text style={styles.initials}>{initials}</Text>}
        </PolishedPressable>
        <View style={styles.details}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={profile.bio ? styles.bio : styles.bioPlaceholder}>{profile.bio || 'Add a bio'}</Text>
          <PolishedPressable accessibilityRole="button" onPress={edit} style={styles.edit}><Text style={styles.link}>Edit profile</Text></PolishedPressable>
        </View>
      </View>
      {editing && <View style={styles.editor}>
        <TextInput accessibilityLabel="Your name" value={name} maxLength={40} onChangeText={setName} placeholder="Your name" style={ui.input} textContentType="name" />
        <TextInput accessibilityLabel="Your bio" value={bio} maxLength={160} onChangeText={setBio} placeholder="Add a bio" multiline style={[ui.input, { minHeight: 76, textAlignVertical: 'top' }]} />
        <Text style={ui.muted}>{bio.length}/160</Text>
        <Action disabled={!name.trim()} onPress={() => { updateProfile({ name: name.trim(), bio: bio.trim() }); setEditing(false); }}>Save profile</Action>
        <PolishedPressable accessibilityRole="button" onPress={() => setEditing(false)}><Text style={styles.link}>Cancel</Text></PolishedPressable>
        {profile.avatar && <PolishedPressable accessibilityRole="button" onPress={() => updateProfile({ avatar: '' })}><Text style={styles.link}>Remove photo</Text></PolishedPressable>}
      </View>}
      <Streak days={streak(workouts)} />
    </View>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.tabs} onLayout={event => setTabWidth(event.nativeEvent.layout.width)}>
      {tabWidth > 0 && <Animated.View pointerEvents="none" style={[styles.tabLine, { width: tabWidth / 3, backgroundColor: slide.interpolate({ inputRange: [0, tabWidth / 3, 2 * tabWidth / 3], outputRange: sectionColors, extrapolate: 'clamp' }), transform: [{ translateX: slide }] }]} />}
      {sections.map((label, index) => <PolishedPressable key={label} accessibilityRole="tab" accessibilityState={{ selected: index === section }} accessibilityLabel={label} onPress={() => setSection(index)} style={styles.tab}><SymbolView name={sectionIcons[index]} tintColor={sectionColors[index]} size={25} style={{ opacity: index === section ? 1 : 0.6 }} /></PolishedPressable>)}
    </View>
    {section === 0 ? <WorkoutCalendar /> : <View style={styles.empty}>
      <SymbolView name={section === 1 ? { ios: 'play.rectangle', android: 'video_library', web: 'video_library' } : { ios: 'trophy', android: 'emoji_events', web: 'emoji_events' }} tintColor={rose} size={34} />
      <Text style={ui.emptyTitle}>{section === 1 ? 'No videos yet' : 'No personal bests yet'}</Text>
      <Text style={ui.muted}>{section === 1 ? 'Your workout videos will appear here.' : 'Your strength milestones will appear here.'}</Text>
    </View>}
    <View style={styles.account}>
      <Text style={ui.muted}>{auth.user?.email}</Text>
      <PolishedPressable accessibilityRole="button" disabled={loggingOut} onPress={() => { setLoggingOut(true); setError(null); void auth.logout().catch(error => setError(error.message)).finally(() => setLoggingOut(false)); }}><Text style={styles.link}>{loggingOut ? 'Logging out…' : 'Log out'}</Text></PolishedPressable>
    </View>
  </AppPage>;
}
function WorkoutCalendar() {
  const { workouts } = useTraining();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const cells = monthCells(month.getFullYear(), month.getMonth()), completed = new Set(workouts.map(workout => workout.day)), today = calendarDay();
  const count = cells.filter(day => day && completed.has(day.key)).length;
  function move(offset: number) { setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1)); }
  return <View style={styles.calendar}>
    <View style={styles.monthRow}>
      <PolishedPressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => move(-1)} style={styles.arrow}><SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={c.muted} size={20} /></PolishedPressable>
      <Text accessibilityRole="header" style={styles.month}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
      <PolishedPressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => move(1)} style={styles.arrow}><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} tintColor={c.muted} size={20} /></PolishedPressable>
    </View>
    <View style={styles.grid}>
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <View key={day} style={styles.cell}><Text style={styles.weekday}>{day[0]}</Text></View>)}
      {cells.map((day, index) => <View key={day?.key ?? `blank-${index}`} style={styles.cell}>{day && <View accessibilityLabel={`${day.key}${completed.has(day.key) ? ', workout completed' : ''}${today === day.key ? ', today' : ''}`} style={[styles.day, today === day.key && styles.today, completed.has(day.key) && styles.completed]}><Text style={[styles.dayText, completed.has(day.key) && styles.completedText]}>{day.number}</Text></View>}</View>)}
    </View>
    <View style={styles.legend}><View style={styles.dot} /><Text style={ui.muted}>Workout completed · {count} {count === 1 ? 'day' : 'days'} this month</Text></View>
  </View>;
}
const styles = StyleSheet.create({
  profile: { paddingTop: 18, paddingBottom: 22, gap: 22, borderBottomWidth: 1, borderBottomColor: '#CBD1D5' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 20 }, details: { flex: 1, gap: 6 },
  avatar: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft, borderWidth: 2, borderColor: 'white' },
  photo: { width: '100%', height: '100%' }, initials: { fontFamily: t.strong, fontSize: 30, color: rose },
  name: { fontFamily: t.strong, fontSize: 27, lineHeight: 32, color: c.text }, bio: { fontFamily: t.family, fontSize: 16, lineHeight: 23, color: c.text }, bioPlaceholder: { fontFamily: t.family, fontSize: 16, color: c.muted },
  edit: { alignSelf: 'flex-start', paddingVertical: 4 }, link: { fontFamily: t.label, fontSize: 15, color: rose, paddingVertical: 5 }, editor: { gap: 10 },
  tabs: { flexDirection: 'row', position: 'relative', borderBottomWidth: 1, borderBottomColor: '#E0E2E5' }, tab: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 16, minHeight: 48 }, tabText: { fontFamily: t.label, fontSize: 16, color: c.muted }, tabLine: { position: 'absolute', bottom: -1, height: 3, borderRadius: 2, backgroundColor: rose },
  calendar: { paddingTop: 4, gap: 18 }, monthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, month: { fontFamily: t.label, fontSize: 20, color: c.text }, arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, grid: { flexDirection: 'row', flexWrap: 'wrap' }, cell: { width: '14.285714%', height: 46, alignItems: 'center', justifyContent: 'center' }, weekday: { fontFamily: t.label, fontSize: 13, color: c.muted }, day: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 }, dayText: { fontFamily: t.label, fontSize: 16, color: c.text }, today: { borderWidth: 1, borderColor: rose }, completed: { backgroundColor: rose }, completedText: { color: 'white' }, legend: { flexDirection: 'row', gap: 8, alignItems: 'center' }, dot: { width: 8, height: 8, backgroundColor: rose, borderRadius: 4 },
  empty: { paddingVertical: 42, gap: 16, minHeight: 260 }, account: { borderTopWidth: 1, borderTopColor: '#E0E2E5', marginTop: 22, paddingTop: 18, gap: 6 }, error: { fontFamily: t.family, color: '#9C3434', fontSize: 16 },
});
