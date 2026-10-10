import { Text, View } from 'react-native';
import type { ExerciseId } from '@/data/workout';
import { exercises } from '@/data/workout';
import { ui } from '@/components/AppPage';
export function BodyPreview({ selected }: { selected: ExerciseId | null; playing: boolean; height?: number }) {
  return <View style={{ minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 10 }}><Text style={ui.heading}>{exercises.find(e => e.id === selected)?.muscles ?? 'Your workout, in focus'}</Text><Text style={[ui.muted, { textAlign: 'center' }]}>The interactive figure is available on web. Select an exercise below to review its sets.</Text></View>;
}
