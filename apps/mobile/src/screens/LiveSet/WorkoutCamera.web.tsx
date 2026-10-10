import { Text, View } from 'react-native';
import { GlassChoice } from '@/components/GlassChoice';
import { ui } from '@/components/AppPage';
import type { ExerciseSpec } from '@/engine/types';
import type { WorkoutSet } from '@/services/workoutApi';
import type { SetFeedback } from './setRecord';
export default function WorkoutCamera({ onManual, manualLabel = 'Track manually' }: { manualLabel?: string; spec: ExerciseSpec; initialPosition?: 'front' | 'back'; onComplete: (record: WorkoutSet, feedback: SetFeedback) => void; onManual: () => void; baseline: number }) {
  return <View style={{ gap: 12 }}><Text style={ui.muted}>Camera rep tracking is available in the iPhone app.</Text><GlassChoice label={manualLabel} onPress={onManual} compact /></View>;
}
