import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/screens/Auth/session';
import { calendarDay } from '@/data/workout';
import { clearPlan, fetchPlan, readPlan, savePlan, selectPlanDate, subscribePlans, timeZone, weekStart } from './plan';
export function useWeeklyPlan() {
 const auth = useAuth(), account = auth.user?.id ?? null;
 const [today, setToday] = useState(calendarDay);
 useEffect(() => { const timer = setInterval(() => setToday(calendarDay()), 60000); return () => clearInterval(timer); }, []);
 const week = weekStart(today), zone = timeZone();
 const request = useRef(auth.apiFetch); useLayoutEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
 const [, setRevision] = useState(0);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const controller = useRef<AbortController | null>(null), loading = useRef(false);
 useLayoutEffect(() => subscribePlans(() => setRevision(value => value + 1)), []);
 const cached = account ? readPlan(account, week) : null;
 const load = useCallback(async (generate = false) => {
  if (!account || loading.current || !controller.current || controller.current.signal.aborted) return;
  const signal = controller.current.signal; loading.current = true; setBusy(true); setError(null);
  const timeout = setTimeout(() => { controller.current?.signal === signal && controller.current.abort(); }, 45000);
  try {
   const plan = await fetchPlan(request.current, zone, generate, signal);
   if (signal.aborted) return;
   if (!plan) clearPlan(account, week);
   if (plan && plan.weekOf === week) savePlan(account, plan, readPlan(account, week)?.selectedDate ?? today);
   if (plan && plan.weekOf !== week) throw new Error('The server returned a different week. Refresh your plan.');
  } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load your plan.'); }
  finally { clearTimeout(timeout); if (controller.current?.signal === signal) { loading.current = false; setBusy(false); if (signal.aborted) setError('The plan request timed out. Try again.'); } }
 }, [account, zone, week, today, setBusy, setError]);
 const run = useCallback((generate = false) => { if (!controller.current || controller.current.signal.aborted) controller.current = new AbortController(); return load(generate); }, [load]);
 useFocusEffect(useCallback(() => {
  controller.current = new AbortController(); loading.current = false; setError(null);
  void load();
  return () => { const previous = controller.current; controller.current = null; previous?.abort(); };
 }, [load, setError]));
 return { plan: cached?.plan ?? null, selectedDate: cached?.selectedDate ?? today, today, week, busy, error,
  refresh: () => run(), generate: () => run(true), selectDate: (date: string) => { if (account) selectPlanDate(account, week, date); } };
}
