import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, ui } from '@/components/AppPage';
import { GlassChoice } from '@/components/GlassChoice';
import { useOnboarding } from '@/screens/Onboarding/state';

const questions = [
  { label: 'Goals', hint: 'Your three goals and areas to build.' },
  { label: 'Experience & personal bests', hint: 'Your training level and starting lifts.' },
  { label: 'Workout schedule', hint: 'Weekly days or a repeating rhythm.' },
  { label: 'Injuries & limitations', hint: 'Anything to keep in mind as you train.' },
];
export default function SettingsScreen() {
  const { setStep } = useOnboarding();
  return <AppPage title="Settings" intro="Your training, your way." headerAction={<GlassChoice compact label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/me')} />}>
    <Text style={ui.muted}>Revisit your setup answers anytime. Continue through the questions to save your changes.</Text>
    <View style={{ gap: 22, paddingTop: 14 }}>{questions.map((question, step) => <View key={question.label} style={{ gap: 8 }}>
      <GlassChoice compact label={question.label} onPress={() => { setStep(step); router.push({ pathname: '/onboarding', params: { from: 'settings' } }); }} />
      <Text style={ui.muted}>{question.hint}</Text>
    </View>)}</View>
  </AppPage>;
}
