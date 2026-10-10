import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SetupPage } from '@/components/SetupPage';
import { GlassChoice } from '@/components/GlassChoice';
import { colors as c, typography as t } from '@/theme/tokens';
import CameraCheck from './CameraCheck';
import { PlacementDiagram } from './PlacementDiagram';
import { cameraExercises as exerciseOptions, cameraSpec } from './exercises';

const copy = [
  { eyebrow: 'Choose your spot', title: 'Choose your workout spot', intro: 'Stand where you’ll do your reps. Leave room for the full movement.' },
  { eyebrow: 'Place your phone', title: 'Place your phone', intro: 'Set your phone about 8 feet away on a stable support.' },
  { eyebrow: 'Check your frame', title: 'Check your framing', intro: 'Return to your workout spot. Keep your whole body in view.' },
];
export default function CameraSetupScreen() {
  const params = useLocalSearchParams<{ exercise?: string; returnTo?: string }>();
  const [step, setStep] = useState(0), [exercise, setExercise] = useState(cameraSpec(params.exercise).id);
  const sideOn = cameraSpec(exercise).recommended_view === 'side';
  function returnToWorkout() { if (params.returnTo === 'workout' && router.canGoBack()) router.back(); else router.replace({ pathname: '/workout', params: { setup: 'done' } }); }
  return <SetupPage compact={step === 2} step={step} total={3} {...copy[step]} action={step === 0 ? 'I’ve chosen my spot' : step === 1 ? 'Check my framing' : 'Start manual workout'} onAction={() => step < 2 ? setStep(step + 1) : returnToWorkout()} onBack={() => step ? setStep(step - 1) : router.canGoBack() ? router.back() : router.replace('/')} secondary={step < 2 ? 'Continue without camera' : undefined} onSecondary={returnToWorkout}>
    {step === 0 && <>
      <View style={s.group}><Text style={s.section}>What are you training?</Text><View style={s.wrap}>{exerciseOptions.map(option => <GlassChoice key={option.id} label={option.label} radio selected={exercise === option.id} onPress={() => setExercise(option.id)} />)}</View></View>
      <Text style={s.text}>Use a floor seam or landmark to mark your spot.</Text>
    </>}
    {step === 1 && <>
      <PlacementDiagram sideOn={sideOn} /><View style={s.group}><Text style={s.section}>{sideOn ? 'Film from your side.' : 'Face the camera.'}</Text><Text style={s.text}>{sideOn ? 'Place the phone beside your exercise spot for a side-on view.' : 'Point the camera toward your exercise spot. Use the front camera if you want to see the guide.'}</Text><Text style={s.text}>Start with the phone around waist height, upright and level. Keep your head, hands and feet in view.</Text></View>
      <Text style={s.caption}>Start at about 8 feet. Adjust the distance during the framing check.</Text>
    </>}
    {step === 2 && <CameraCheck exercise={exercise} onContinue={returnToWorkout} />}
  </SetupPage>;
}
const s = StyleSheet.create({ group: { gap: 12 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, section: { fontFamily: t.label, fontSize: 21, color: c.text }, text: { fontFamily: t.family, fontSize: 17, lineHeight: 26, color: c.muted }, caption: { fontFamily: t.family, fontSize: 14, lineHeight: 21, color: c.muted } });
