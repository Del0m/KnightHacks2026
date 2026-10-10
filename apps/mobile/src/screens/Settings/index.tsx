import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, ui } from '@/components/AppPage';
import { GlassChoice } from '@/components/GlassChoice';
import { useOnboarding } from '@/screens/Onboarding/state';

const questions = ['Goals', 'Experience & personal bests', 'Workout schedule', 'Injuries & limitations'];
export default function SettingsScreen() {
  const { setStep } = useOnboarding();
  return <AppPage title="Settings" intro="Training settings" headerAction={<GlassChoice compact label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/me')} />}>
    <Text style={ui.muted}>Edit your answers, then continue to save.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 8 }}>{questions.map((label, step) => <View key={label} style={{ flexBasis: '47%', flexGrow: 1 }}>
      <GlassChoice compact label={label} style={{ flex: 1, minHeight: 76 }} onPress={() => { setStep(step); router.push({ pathname: '/onboarding', params: { from: 'settings' } }); }} />
    </View>)}</View>
  </AppPage>;
}
