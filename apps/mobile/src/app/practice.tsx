import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { cameraSpec } from '@/screens/LiveSet/exercises';
import WorkoutCamera from '@/screens/LiveSet/WorkoutCamera';
import type { SetFeedback } from '@/screens/LiveSet/setRecord';

/** Practice uses the live form engine without saving or uploading workout sets. */
export default function PracticeScreen() {
  const { exercise } = useLocalSearchParams<{ exercise?: string }>();
  const spec = cameraSpec(exercise);
  const [feedback, setFeedback] = useState<SetFeedback | null>(null), [attempt, setAttempt] = useState(0);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const leave = () => { if (!completingRef.current) router.replace('/'); };
  return <AppPage title="Practice" intro={spec.name} headerAction={<Action secondary disabled={completing} onPress={leave}>Return to Training</Action>}>
    {feedback ? <>
      <Text accessibilityRole="header" style={ui.heading}>Practice complete</Text>
      <Text accessibilityLiveRegion="polite" style={ui.text}>{feedback.note}</Text>
      <Action tone="green" onPress={() => { setFeedback(null); setAttempt(n => n + 1); }}>Practice again</Action>
      <Action secondary disabled={completing} onPress={leave}>Return to Training</Action>
    </> : <WorkoutCamera key={`${spec.id}-${attempt}`} spec={spec} baseline={.7} onFinishing={() => { completingRef.current = true; setCompleting(true); }} onComplete={(_record, result) => { completingRef.current = false; setCompleting(false); setFeedback(result); }} onManual={leave} manualLabel="Return to Training" />}
  </AppPage>;
}
