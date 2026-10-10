import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SetupPage } from '@/components/SetupPage';
import { GlassChoice } from '@/components/GlassChoice';
import { colors as c, typography as t } from '@/theme/tokens';
import { useAuth } from '@/screens/Auth/session';
import { bestExercises, dateFromDay, goalGroups, toggleGoal, upcomingDays, validateStep, weekdays, type Draft } from './model';
import { useOnboarding } from './state';

const copy = [
  { eyebrow: 'Your goals', title: 'Make it yours.', intro: 'Pick 3 things to work toward. Mix training goals and areas you want to build.' },
  { eyebrow: 'Your experience', title: 'Meet you where you are.', intro: 'A starting point, not a test. Choose what feels closest.' },
  { eyebrow: 'Your rhythm', title: 'Make room to move.', intro: 'Choose a rhythm that fits your week. You can change it later.' },
  { eyebrow: 'Your body', title: 'Anything to keep in mind?', intro: 'Tell us about an injury or movement limitation, in your own words. This is optional.' },
];
export default function OnboardingScreen() {
  const state = useOnboarding(), auth = useAuth();
  const { draft, setDraft, step, setStep, busy, status } = state;
  const [notice, setNotice] = useState<string | null>(null), [finished, setFinished] = useState(false);
  const heading = useRef<Text>(null);
  useEffect(() => { Keyboard.dismiss(); }, [step]);
  function change(patch: Partial<Draft>) { setDraft({ ...draft, ...patch }); setNotice(null); }
  async function advance(skip = false) {
    const validation = validateStep(skip ? { ...draft, injury: '' } : draft, step);
    if (validation) { setNotice(validation); AccessibilityInfo.announceForAccessibility(validation); return; }
    setNotice(null); Keyboard.dismiss();
    if (step < 3) { setStep(step + 1); return; }
    setFinished(await state.save(skip));
  }
  if (finished && status === 'complete' && !state.error) return <SetupPage step={3} total={4} eyebrow="You're set" title="Your starting point is saved." intro="A little stronger, at your own pace." action="Back to Train" onAction={() => router.replace('/')} onBack={() => { setFinished(false); setStep(0); }}><Text style={s.text}>Your goals, experience and training rhythm are ready for your planner.</Text></SetupPage>;
  const content = copy[step];
  const blocked = busy || status === 'loading';
  return <SetupPage step={step} total={4} {...content} action={busy ? 'Saving…' : step === 3 ? 'Finish setup' : 'Continue'} disabled={blocked} onAction={() => { void advance(); }} onBack={() => { if (busy) return; setNotice(null); if (step) setStep(step - 1); else router.replace('/'); }} secondary={step === 3 ? 'Skip injury note' : 'Set up later'} onSecondary={() => { if (step === 3) void advance(true); else router.replace('/'); }}>
    {status === 'loading' ? <ActivityIndicator color={c.primary} accessibilityLabel="Loading your profile" /> : <View style={{ gap: 28 }} pointerEvents={busy ? 'none' : 'auto'}>
      {step === 0 && <>
        <View style={s.count}><Text ref={heading} accessibilityLiveRegion="polite" style={s.label}>{draft.goals.length} / 3 selected</Text><Text style={s.muted}>Choose what matters.</Text></View>
        {goalGroups.map(group => <View key={group.title} style={s.group}><Text accessibilityRole="header" style={s.section}>{group.title}</Text><View style={s.wrap}>{group.goals.map(goal => <GlassChoice key={goal.id} testID={`goal-${goal.id}`} label={goal.label} selected={draft.goals.includes(goal.id)} onPress={() => {
          if (draft.goals.length === 3 && !draft.goals.includes(goal.id)) { setNotice('Three is plenty. Deselect a goal to choose another.'); AccessibilityInfo.announceForAccessibility('Deselect a goal to choose another.'); return; }
          change({ goals: toggleGoal(draft.goals, goal.id) });
        }} />)}</View></View>)}
      </>}
      {step === 1 && <>
        <View style={s.experience}>{(['beginner', 'experienced', 'advanced'] as const).map(level => <GlassChoice key={level} testID={`level-${level}`} label={level[0].toUpperCase() + level.slice(1)} radio selected={draft.experience === level} onPress={() => change({ experience: level })} />)}</View>
        {draft.experience && draft.experience !== 'beginner' && <View style={s.group}>
          <Text accessibilityRole="header" style={s.section}>Your personal bests</Text><Text style={s.muted}>Add any best you remember. Weight and reps help us understand your starting point.</Text>
          <GlassChoice label="I don’t know yet" selected={draft.unknownBests} onPress={() => change({ unknownBests: !draft.unknownBests })} />
          {!draft.unknownBests && <>
            <View style={s.wrap}>{(['lb', 'kg'] as const).map(unit => <GlassChoice compact key={unit} label={unit} selected={draft.unit === unit} radio onPress={() => {
              if (unit === draft.unit) return;
              change({ unit, bests: draft.bests.map(b => ({ ...b, weight: b.weight.trim() && Number.isFinite(Number(b.weight)) ? String(Math.round(Number(b.weight) * (unit === 'kg' ? 1 / 2.20462 : 2.20462) * 100) / 100) : b.weight })) });
            }} />)}</View>
            {draft.bests.map((best, i) => <View key={best.exercise} style={s.best}><Text style={s.label}>{bestExercises[i].label}</Text><View style={s.inputs}>
              <TextInput accessibilityLabel={`${bestExercises[i].label} weight in ${draft.unit}`} placeholder={`Weight (${draft.unit})`} placeholderTextColor={c.muted} value={best.weight} keyboardType="decimal-pad" inputMode="decimal" maxLength={8} onChangeText={weight => change({ bests: draft.bests.map((b, n) => n === i ? { ...b, weight } : b) })} style={[s.input, s.half]} />
              <TextInput accessibilityLabel={`${bestExercises[i].label} reps`} placeholder="Reps" placeholderTextColor={c.muted} value={best.reps} keyboardType="number-pad" inputMode="numeric" maxLength={3} onChangeText={reps => change({ bests: draft.bests.map((b, n) => n === i ? { ...b, reps } : b) })} style={[s.input, s.half]} />
            </View></View>)}
          </>}
        </View>}
      </>}
      {step === 2 && <>
        <View style={s.wrap}><GlassChoice label="Weekly days" radio selected={draft.scheduleMode === 'weekly'} onPress={() => change({ scheduleMode: 'weekly' })} /><GlassChoice label="Every few days" radio selected={draft.scheduleMode === 'interval'} onPress={() => change({ scheduleMode: 'interval' })} /></View>
        {draft.scheduleMode === 'weekly' ? <View style={s.group}>
          <View style={s.wrap}>{[1, 2, 3, 4, 5, 6, 0].map(day => <GlassChoice key={day} testID={`day-${day}`} label={weekdays[day]} selected={draft.days.includes(day)} onPress={() => change({ days: draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day] })} />)}</View>
          <GlassChoice compact label="Use Mon / Wed / Fri" onPress={() => change({ days: [1, 3, 5] })} />
        </View> : <View style={s.group}>
          <Text style={s.label}>Train every how many days?</Text><TextInput accessibilityLabel="Training interval in days" value={draft.interval} onChangeText={interval => change({ interval })} keyboardType="number-pad" inputMode="numeric" maxLength={2} style={s.input} /><Text style={s.muted}>Every 3 days means two rest days between workouts.</Text>
          <Text style={s.label}>Starting date</Text><TextInput accessibilityLabel="Starting date, YYYY-MM-DD" value={draft.startDate} onChangeText={startDate => change({ startDate })} placeholder="YYYY-MM-DD" placeholderTextColor={c.muted} autoCorrect={false} maxLength={10} style={s.input} />
        </View>}
        <View style={s.preview}><Text style={s.label}>Your next training days</Text><Text style={s.text}>{upcomingDays(draft).map(day => dateFromDay(day)!.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })).join('  ·  ') || 'Choose your schedule to see a preview.'}</Text></View>
      </>}
      {step === 3 && <View style={s.group}>
        <TextInput testID="injury-note" accessibilityLabel="Injury or movement limitation, optional" multiline textAlignVertical="top" placeholder="For example: My left knee bothers me during deep squats." placeholderTextColor={c.muted} value={draft.injury} onChangeText={injury => change({ injury })} maxLength={1000} style={[s.input, s.note]} />
        <Text style={s.muted}>{draft.injury.length} / 1,000</Text><Text style={s.disclaimer}>Not medical advice. Spotter supports your fitness routine. Follow the guidance of your clinician or physio.</Text>
      </View>}
      {(notice || state.error) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{notice || state.error}</Text>}
      {status === 'error' && <GlassChoice compact label="Retry profile connection" onPress={() => { void state.reload(); }} />}
      {!auth.user && <Text style={s.muted}>Explore setup now. Log in from Me to save it to your account.</Text>}
    </View>}
  </SetupPage>;
}
const s = StyleSheet.create({
  group: { gap: 14 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, experience: { gap: 12 },
  count: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  section: { fontFamily: t.label, fontSize: 19, color: c.text }, label: { fontFamily: t.label, fontSize: 15, color: c.text },
  text: { fontFamily: t.family, fontSize: 17, lineHeight: 26, color: c.text }, muted: { fontFamily: t.family, fontSize: 14, lineHeight: 21, color: c.muted },
  best: { gap: 8 }, inputs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, half: { flex: 1, minWidth: 100 },
  input: { minHeight: 52, fontFamily: t.family, fontSize: 17, color: c.text, borderWidth: 1, borderColor: '#BDD6E6', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.76)', paddingHorizontal: 16, paddingVertical: 14 },
  note: { minHeight: 180 }, preview: { gap: 8, paddingTop: 18, borderTopWidth: 1, borderColor: c.border },
  disclaimer: { fontFamily: t.family, fontSize: 14, lineHeight: 22, color: c.text }, error: { fontFamily: t.label, fontSize: 15, lineHeight: 22, color: '#963C30' },
});
