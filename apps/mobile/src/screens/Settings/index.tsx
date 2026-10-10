import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, ui } from '@/components/AppPage';
import { GlassChoice } from '@/components/GlassChoice';
import { useOnboarding } from '@/screens/Onboarding/state';

const questions = [
  { label: 'Goals', hint: 'Training goals and muscle groups.' },
  { label: 'Experience & personal bests', hint: 'Experience level and personal bests.' },
  { label: 'Workout schedule', hint: 'Workout days and intervals.' },
  { label: 'Injuries & limitations', hint: 'Optional injury notes.' },
];
export default function SettingsScreen() {
  const { setStep } = useOnboarding();
  return <AppPage title="Settings" intro="Training settings" headerAction={<GlassChoice compact label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/me')} />}>
    <Text style={ui.muted}>Edit your answers, then continue to save.</Text>
    <View style={{ gap: 22, paddingTop: 14 }}>{questions.map((question, step) => <View key={question.label} style={{ gap: 8 }}>
      <GlassChoice compact label={question.label} onPress={() => { setStep(step); router.push({ pathname: '/onboarding', params: { from: 'settings' } }); }} />
      <Text style={ui.muted}>{question.hint}</Text>
    </View>)}</View>
  </AppPage>;
}
