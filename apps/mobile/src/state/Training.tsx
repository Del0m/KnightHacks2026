/* eslint-disable @typescript-eslint/no-require-imports -- Load native MMKV only on native platforms. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { calendarDay, initialProfile, readSaved, type Profile, readWorkoutDetails, type WorkoutDetailSet, type Workout } from '@/data/workout';
type State = { profile: Profile; workouts: Workout[] };
const empty: State = { profile: initialProfile, workouts: [] };
type TrainingValue = State & { updateProfile: (p: Partial<Profile>) => void; finish: (sets: number, reps: number, minutes: number, details?: WorkoutDetailSet[], id?: string) => string; removeWorkout: (id: string) => void };
const Training = createContext<TrainingValue | null>(null);
export function TrainingProvider({ children, accountId }: { children: ReactNode; accountId?: string }) {
  // Guest history remains in its old key; it is never assigned to a new account.
  const key = accountId ? `spotter-training-v1:${encodeURIComponent(accountId)}` : 'spotter-training-v1';
  return <TrainingSession key={key} storageKey={key}>{children}</TrainingSession>;
}
function TrainingSession({ children, storageKey: key }: { children: ReactNode; storageKey: string }) {
  const [state, setState] = useState<State>(() => {
    return loadTraining(key);
  });
  const currentState = useRef(state);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function changed(event: StorageEvent) { if (event.key === key || event.key === null) { try { const next = readSaved(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? empty; currentState.current = next; setState(next); } catch { currentState.current = empty; setState(empty); } } }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);
  function publish(change: (state: State) => State) {
    const next = change(currentState.current);
    currentState.current = next; saveTraining(key, next); setState(next);
  }
  function updateProfile(profile: Partial<Profile>) { publish(state => ({ ...state, profile: { ...state.profile, ...profile } })); }
  function finish(sets: number, reps: number, minutes: number, details?: WorkoutDetailSet[], savedId?: string) {
    const now = new Date(), id = savedId ?? `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    publish(state => ({ ...state, workouts: [{ id, day: calendarDay(now), finishedAt: now.toISOString(), sets, reps, minutes, details: readWorkoutDetails(details) }, ...state.workouts.filter(w => w.id !== id)].slice(0, 500) })); return id;
  }
  function removeWorkout(id: string) { publish(state => ({ ...state, workouts: state.workouts.filter(w => w.id !== id) })); }
  return <Training.Provider value={{ ...state, updateProfile, finish, removeWorkout }}>{children}</Training.Provider>;
}
export function useTraining() { const state = useContext(Training); if (!state) throw new Error('TrainingProvider missing'); return state; }

let nativeStore: import('react-native-mmkv').MMKV | undefined;
function store() {
  // Web uses localStorage; native history survives process exits in MMKV.
  return nativeStore ??= (require('react-native-mmkv') as typeof import('react-native-mmkv')).createMMKV({ id: 'training' });
}
function loadTraining(key: string): State {
  try {
    const json = Platform.OS === 'web' ? typeof window !== 'undefined' ? localStorage.getItem(key) : null : store().getString(key);
    return readSaved(JSON.parse(json ?? 'null')) ?? empty;
  } catch { return empty; }
}
function saveTraining(key: string, state: State) {
  try {
    const json = JSON.stringify(state);
    if (Platform.OS === 'web') localStorage.setItem(key, json); else store().set(key, json);
  } catch { /* A restricted environment remains usable for this session. */ }
}
