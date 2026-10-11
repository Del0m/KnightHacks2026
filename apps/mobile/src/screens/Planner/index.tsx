import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { PolishedPressable } from '@/components/PolishedPressable';
import { useAuth } from '@/screens/Auth/session';
import { useOnboarding } from '@/screens/Onboarding/state';
import { useTraining } from '@/state/Training';
import { isWorkoutDay } from '@/data/workout';
import { pageColors } from '@/theme/tokens';
import { addPlanDays, dateForDay, upcomingWorkouts } from './plan';
import { useWeeklyPlan } from './useWeeklyPlan';
const c = pageColors('Plan'), ui = pageStyles('Plan');
const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export default function PlannerScreen() {
 const auth = useAuth(), setup = useOnboarding(), training = useTraining(), weekly = useWeeklyPlan();
 const [expanded, setExpanded] = useState<string | null>(null);
 const dates = names.map((_, day) => addPlanDays(weekly.week, day));
 const schedule = setup.profile?.schedule ?? { kind: 'weekly' as const, days: training.profile.days };
 const upcoming = upcomingWorkouts(weekly.today, schedule, weekly.plan, training.workouts);
 const scheduled = (date: string) => weekly.plan ? weekly.plan.days.some(d => d.date === date && d.items.length > 0) : isWorkoutDay(date, schedule);
 return <AppPage title="Plan">
  <Text style={ui.pageTitle}>Next 3 workouts</Text>
  <Text style={ui.muted}>{dateForDay(weekly.week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {dateForDay(dates[6]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
  <View style={{ flexDirection: 'row', gap: 5 }}>{dates.map((date, day) => <PolishedPressable key={date} accessibilityRole="button" accessibilityLabel={`${names[day]}, ${scheduled(date) ? 'workout' : 'rest day'}`} accessibilityState={{ selected: weekly.selectedDate === date }} onPress={() => weekly.selectDate(date)} style={{ flex: 1, borderRadius: 17, minHeight: 78, gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: weekly.selectedDate === date ? c.primary : c.border }}><GlassSurface radius={17} tint={scheduled(date) ? c.primarySoft : '#FFFFFF'} colored={scheduled(date)} /><Text style={ui.label}>{names[day]}</Text><Text style={ui.rowTitle}>{dateForDay(date).getDate()}</Text><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: scheduled(date) ? c.primary : 'transparent' }} /></PolishedPressable>)}</View>
  {auth.user ? <>
   <Action disabled={weekly.busy} onPress={() => { void weekly.generate(); }}>{weekly.busy ? 'Preparing your week…' : weekly.plan ? 'Regenerate week' : 'Generate week'}</Action>
   {weekly.busy && <ActivityIndicator accessibilityLabel="Loading weekly plan" color={c.primary} />}
   {weekly.error && <><Text accessibilityRole="alert" style={ui.muted}>{weekly.error}</Text>{weekly.plan && <Text style={ui.muted}>Showing your saved week.</Text>}<Action secondary onPress={() => { void weekly.refresh(); }}>Try again</Action></>}
   {!weekly.plan && !weekly.busy && <Text style={ui.muted}>Generate your week using your goals and training schedule.</Text>}
  </> : <><Text style={ui.muted}>Log in to generate and save a personal plan.</Text><Action onPress={() => router.push('/login')}>Log in</Action></>}
  <>
   {weekly.plan?.notes.map((note, i) => <Text key={i} style={ui.muted}>{note}</Text>)}
   {upcoming.map(({ date, items, generated }) => {
    return <View key={date} testID={`upcoming-${date}`} style={{ padding: 18, borderRadius: 24, gap: 12, borderWidth: 1, borderColor: weekly.selectedDate === date ? c.primary : c.border }}><GlassSurface radius={24} tint={c.primarySoft} colored />
     <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text accessibilityRole="header" style={ui.rowTitle}>{dateForDay(date).toLocaleDateString(undefined, { weekday: 'long' })}</Text><Text style={ui.label}>{dateForDay(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></View>
     {!generated && <Text style={ui.muted}>Daily full body</Text>}
     <>{items.map(item => <View key={item.itemId} style={{ gap: 8 }}><PolishedPressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.itemId }} accessibilityHint={generated ? 'Show why this exercise and its sources' : 'Daily full-body exercise'} onPress={() => { if (generated) setExpanded(value => value === item.itemId ? null : item.itemId); }} style={{ minHeight: 52, flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ flex: 1, gap: 3 }}><Text style={ui.text}>{item.name}</Text>{!item.tracked && <Text style={[ui.muted, { fontSize: 12 }]}>Manual logging</Text>}</View><Text style={ui.label}>{item.sets} × {item.reps}</Text></PolishedPressable>
      {item.swapNote && <Text style={ui.muted}>{item.swapNote}</Text>}
      {expanded === item.itemId && <View style={{ gap: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.primary }}><Text style={ui.text}>{item.reason || 'Selected for your training plan.'}</Text>{item.safetyNote && <Text style={ui.muted}>{item.safetyNote}</Text>}<Text style={ui.label}>Sources</Text>{item.sources.length ? item.sources.map(source => <View key={source.id}><Text style={ui.muted}>{source.title}</Text><Text style={[ui.muted, { fontSize: 11 }]}>{source.id}</Text></View>) : <Text style={ui.muted}>No source supplied.</Text>}</View>}
     </View>)}{(generated || date === weekly.today) && <Action secondary onPress={() => { weekly.selectDate(date); router.navigate('/'); }}>View workout</Action>}</>
    </View>;
   })}
   {!upcoming.length && <Text style={ui.muted}>Choose workout days in Settings to see your next workouts.</Text>}
  </>
  <Action secondary onPress={() => router.push('/onboarding')}>Edit goals & schedule</Action>
 </AppPage>;
}
