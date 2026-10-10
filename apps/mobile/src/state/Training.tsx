import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { calendarDay, initialProfile, readSaved, type Profile, type Workout } from '@/data/workout';
type State = { profile: Profile; workouts: Workout[] };
const empty: State = { profile: initialProfile, workouts: [] };
type TrainingValue = State & { updateProfile: (p: Partial<Profile>) => void; finish: (sets: number, reps: number, minutes: number) => string; removeWorkout: (id: string) => void };
const Training = createContext<TrainingValue | null>(null);
export function TrainingProvider({ children, accountId }: { children: ReactNode; accountId?: string }) {
  // Guest history remains in its old key; it is never assigned to a new account.
  const key = accountId ? `spotter-training-v1:${encodeURIComponent(accountId)}` : 'spotter-training-v1';
  const [state, setState] = useState<State>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') try { return readSaved(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? empty; } catch { /* Storage disabled; use memory. */ }
    return empty;
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function changed(event: StorageEvent) { if (event.key === key || event.key === null) { try { setState(readSaved(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? empty); } catch { setState(empty); } } }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);
  useEffect(() => { if (Platform.OS === 'web') try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Keep the session usable. */ } }, [key, state]);
  function publish(change: (state: State) => State) { setState(change); }
  function updateProfile(profile: Partial<Profile>) { publish(state => ({ ...state, profile: { ...state.profile, ...profile } })); }
  function finish(sets: number, reps: number, minutes: number) {
    const now = new Date(), id = now.getTime().toString();
    publish(state => ({ ...state, workouts: [{ id, day: calendarDay(now), finishedAt: now.toISOString(), sets, reps, minutes }, ...state.workouts].slice(0, 500) })); return id;
  }
  function removeWorkout(id: string) { publish(state => ({ ...state, workouts: state.workouts.filter(w => w.id !== id) })); }
  return <Training.Provider value={{ ...state, updateProfile, finish, removeWorkout }}>{children}</Training.Provider>;
}
export function useTraining() { const state = useContext(Training); if (!state) throw new Error('TrainingProvider missing'); return state; }
