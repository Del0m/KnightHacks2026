import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/screens/Auth/session';
import { syncWorkouts } from './workoutQueue';
export function WorkoutSync() {
  const auth = useAuth(), latest = useRef(auth);
  useLayoutEffect(() => { latest.current = auth; }, [auth]);
  useEffect(() => {
    const account = auth.user?.id; if (!account) return;
    const sync = () => { if (latest.current.user?.id === account) void syncWorkouts(account, (path, options) => { if (latest.current.user?.id !== account) return Promise.reject(new Error('Account changed')); return latest.current.apiFetch(path, options); }).catch(() => {}); };
    sync(); const timer = setInterval(sync, 30000), subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [auth.user?.id]);
  return null;
}
