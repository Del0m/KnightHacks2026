import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { calendarDay, initialProfile, readSaved, type Profile, type Workout } from '@/data/workout';
type State = { profile: Profile; workouts: Workout[] };
const empty: State = { profile: initialProfile, workouts: [] }, listeners = new Set<() => void>();
let saved: State | null = null;
function snapshot(): State {
  if (saved) return saved;
  if (Platform.OS === 'web' && typeof window !== 'undefined') try { saved = readSaved(JSON.parse(localStorage.getItem('spotter-training-v1') ?? 'null')); } catch { /* Storage disabled; use memory. */ }
  return saved ??= empty;
}
function publish(next: State) {
  saved = next;
  if (Platform.OS === 'web') try { localStorage.setItem('spotter-training-v1', JSON.stringify(next)); } catch { /* Keep the session usable. */ }
  listeners.forEach(l => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  function changed(event: StorageEvent) { if (event.key !== 'spotter-training-v1') return; saved = null; listeners.forEach(l => l()); }
  if (Platform.OS === 'web') window.addEventListener('storage', changed);
  return () => { listeners.delete(listener); if (Platform.OS === 'web') window.removeEventListener('storage', changed); };
}
function updateProfile(p: Partial<Profile>) { const state = snapshot(); publish({ ...state, profile: { ...state.profile, ...p } }); }
function finish(sets: number, reps: number, minutes: number) {
  const now = new Date(), state = snapshot(), id = now.getTime().toString();
  publish({ ...state, workouts: [{ id, day: calendarDay(now), finishedAt: now.toISOString(), sets, reps, minutes }, ...state.workouts].slice(0, 500) });
  return id;
}
function removeWorkout(id: string) { const state = snapshot(); publish({ ...state, workouts: state.workouts.filter(w => w.id !== id) }); }
const Training = createContext<(State & { updateProfile: typeof updateProfile; finish: typeof finish; removeWorkout: typeof removeWorkout }) | null>(null);
export function TrainingProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => empty);
  return <Training.Provider value={{ ...state, updateProfile, finish, removeWorkout }}>{children}</Training.Provider>;
}
export function useTraining() { const state = useContext(Training); if (!state) throw new Error('TrainingProvider missing'); return state; }
