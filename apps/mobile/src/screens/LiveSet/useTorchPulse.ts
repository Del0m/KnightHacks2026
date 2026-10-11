import { useCallback, useEffect, useRef, useState } from 'react';

/** One short rear-camera signal, followed by the camera-to-next-screen handoff. */
export function useTorchPulse(enabled: boolean) {
  const [flashing, setFlashing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const done = pending.current; pending.current = null;
    setFlashing(false); done?.();
  }, []);
  const signal = useCallback((done: () => void) => {
    if (pending.current) return;
    if (!enabled) { done(); return; }
    pending.current = done; setFlashing(true);
    timer.current = setTimeout(finish, 200);
  }, [enabled, finish]);
  useEffect(() => {
    if (!enabled && pending.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finish, 0);
    }
  }, [enabled, finish]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; pending.current = null;
  }, []);
  return { signal, flashing: enabled && flashing, torchMode: enabled && flashing ? 'on' as const : 'off' as const };
}
