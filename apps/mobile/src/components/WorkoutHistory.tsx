import { Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { pageStyles } from './AppPage';
import { exercises, type Workout } from '@/data/workout';
import { getSpec } from '@/engine/specs';

const ui = pageStyles('Me');
export function WorkoutHistory({ workouts }: { workouts: Workout[] }) {
  return <View style={{ gap: 14 }}>{workouts.map((workout, index) => <View key={workout.id} style={{ padding: 18, gap: 8, borderRadius: 24, borderWidth: 1, borderColor: 'white', overflow: 'hidden' }}>
    <GlassSurface />
    <Text accessibilityRole="header" style={ui.rowTitle}>Workout {workouts.length - index} · {new Date(workout.finishedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
    <Text style={ui.text}>{workout.sets} sets · {workout.reps} reps · {workout.minutes} min</Text>
    {workout.details?.length ? workout.details.map((set, setIndex) => <View key={setIndex} style={{ gap: 3, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#D5E4ED' }}>
      <Text style={ui.label}>Set {setIndex + 1} · {getSpec(set.exercise_id)?.name ?? exercises.find(exercise => exercise.id === set.exercise_id)?.name ?? set.exercise_id.replaceAll('_', ' ')}</Text>
      <Text style={ui.text}>{set.reps} reps{set.goodReps !== undefined ? ` · ${set.goodReps} with good form` : ' · Form not measured'}{set.medal ? ` · ${set.medal} medal` : ''}</Text>
      {!!set.note && <Text style={ui.muted}>{set.note}</Text>}
    </View>) : <Text style={ui.muted}>This earlier workout has totals only. Exercise and form details were not recorded.</Text>}
  </View>)}</View>;
}
