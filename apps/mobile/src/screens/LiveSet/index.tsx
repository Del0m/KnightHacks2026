import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SetupPage } from '@/components/SetupPage';
import { GlassChoice } from '@/components/GlassChoice';
import { colors as c, typography as t } from '@/theme/tokens';
import CameraCheck from './CameraCheck';
import { PlacementDiagram } from './PlacementDiagram';

const exerciseOptions = [{ id: 'curl', label: 'Bicep curl' }, { id: 'squat', label: 'Squat' }, { id: 'press', label: 'Shoulder press' }, { id: 'lunge', label: 'Lunge' }];
const copy = [
  { eyebrow: 'Choose your spot', title: 'Where will you move?', intro: 'Stand where you want to do your reps. Choose a clear spot with room for the whole movement.' },
  { eyebrow: 'Place your phone', title: 'Give the camera some room.', intro: 'Place your phone about 8 feet from your exercise spot, on a stable stand or support.' },
  { eyebrow: 'Check your frame', title: 'Back to your spot.', intro: 'Return to where you’ll do your reps. We’ll help you adjust the phone until your whole body is in view.' },
];
export default function CameraSetupScreen() {
  const params = useLocalSearchParams<{ exercise?: string; returnTo?: string }>();
  const [step, setStep] = useState(0), [exercise, setExercise] = useState(exerciseOptions.some(e => e.id === params.exercise) ? params.exercise! : 'curl');
  const sideOn = exercise === 'squat' || exercise === 'lunge';
  function returnToWorkout() { if (params.returnTo === 'workout' && router.canGoBack()) router.back(); else router.replace('/workout'); }
  return <SetupPage compact={step === 2} step={step} total={3} {...copy[step]} action={step === 0 ? 'I’ve chosen my spot' : step === 1 ? 'Check my framing' : 'Return to manual workout'} onAction={() => step < 2 ? setStep(step + 1) : returnToWorkout()} onBack={() => step ? setStep(step - 1) : router.canGoBack() ? router.back() : router.replace('/')} secondary={step < 2 ? 'Continue without camera' : undefined} onSecondary={returnToWorkout}>
    {step === 0 && <>
      <View style={s.group}><Text style={s.section}>What are you training?</Text><View style={s.wrap}>{exerciseOptions.map(option => <GlassChoice key={option.id} label={option.label} radio selected={exercise === option.id} onPress={() => setExercise(option.id)} />)}</View></View>
      <Text style={s.text}>Remember your spot using a floor seam or another nearby landmark. You’ll come back here after placing the phone.</Text>
    </>}
    {step === 1 && <>
      <PlacementDiagram sideOn={sideOn} /><View style={s.group}><Text style={s.section}>{sideOn ? 'Film from your side.' : 'Face the camera.'}</Text><Text style={s.text}>{sideOn ? 'For squats and lunges, place the phone beside your exercise spot for a side-on view.' : 'Point the camera toward your exercise spot. Use the front camera if you want to see the guide.'}</Text><Text style={s.text}>Start with the phone around waist height, upright and level. Keep your head, hands and feet in view.</Text></View>
      <Text style={s.caption}>8 feet is a starting suggestion, not a measured distance. The live check will help you fine-tune the placement.</Text>
    </>}
    {step === 2 && <CameraCheck exercise={exercise} onContinue={returnToWorkout} />}
  </SetupPage>;
}
const s = StyleSheet.create({ group: { gap: 12 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, section: { fontFamily: t.label, fontSize: 21, color: c.text }, text: { fontFamily: t.family, fontSize: 17, lineHeight: 26, color: c.muted }, caption: { fontFamily: t.family, fontSize: 14, lineHeight: 21, color: c.muted } });
