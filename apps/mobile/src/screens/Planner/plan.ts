import { Platform } from 'react-native';
import type { ExerciseId } from '@/data/workout';
import type { ApiRequest } from '@/services/workoutApi';
export type Prescription = { id: string; name: string; sets: number; reps: number; tracked: boolean };
export type PlanItem = Prescription & { itemId: string; position: number; reason: string | null; swapNote: string | null; safetyNote: string | null; sources: { id: string; title: string }[] };
export type WeeklyPlan = { id: string; weekOf: string; notes: string[]; days: { day: number; date: string; items: PlanItem[] }[] };
export type PlanCache = { plan: WeeklyPlan; selectedDate: string };
export const modelExercise = (id: string): ExerciseId | null => ({ bicep_curl: 'curl', curl: 'curl', squat: 'squat', shoulder_press: 'press', press: 'press', push_up: 'push_up', lunge: 'lunge' } as Record<string, ExerciseId>)[id] ?? null;
export function dateForDay(day: string) { return new Date(`${day}T12:00:00`); }
export function addPlanDays(day: string, count: number) { const d = dateForDay(day); d.setDate(d.getDate() + count); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function weekStart(day: string) { const d = dateForDay(day); return addPlanDays(day, -((d.getDay() + 6) % 7)); }
export function timeZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v : null;
export function parsePlan(value: unknown): WeeklyPlan | null {
 const p = row(value), weekOf = text(p.week_of ?? p.weekOf);
 if (!text(p.id) || !weekOf || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || weekStart(weekOf) !== weekOf || !Array.isArray(p.days)) return null;
 const days: WeeklyPlan['days'] = [];
 for (const entry of p.days) {
  const d = row(entry), day = Number(d.day), date = text(d.date);
  if (!Number.isInteger(day) || day < 0 || day > 6 || date !== addPlanDays(weekOf, day) || !Array.isArray(d.items) || days.some(existing => existing.day === day)) return null;
  const items: PlanItem[] = [];
  for (const entry of d.items) {
   const i = row(entry), e = row(i.exercise), id = text(e.id), name = text(e.name), sets = Number(i.sets), reps = Number(i.reps);
   if (!id || !name || !Number.isInteger(sets) || sets < 1 || sets > 20 || !Number.isInteger(reps) || reps < 1 || reps > 100) return null;
   items.push({ id, name, sets, reps, tracked: e.tracked === true && modelExercise(id) !== null, itemId: text(i.id) ?? id, position: Number(i.position) || 0,
    reason: text(i.reason), swapNote: text(i.swap_note ?? i.swapNote), safetyNote: text(i.safety_note ?? i.safetyNote), sources: Array.isArray(i.sources) ? i.sources.flatMap(source => { const s = row(source); return text(s.id) && text(s.title) ? [{ id: s.id as string, title: s.title as string }] : []; }) : [] });
  }
  days.push({ day, date: date!, items: items.sort((a, b) => a.position - b.position) });
 }
 return { id: p.id as string, weekOf, notes: Array.isArray(p.notes) ? p.notes.filter((n): n is string => typeof n === 'string') : [], days: days.sort((a, b) => a.day - b.day) };
}
export function routineForDay(plan: WeeklyPlan, date: string): Prescription[] { return (plan.days.find(day => day.date === date)?.items ?? []).map(({ id, name, sets, reps, tracked }) => ({ id, name, sets, reps, tracked })); }
export function readPrescription(value: unknown): Prescription[] | null {
 if (!Array.isArray(value) || !value.length || value.length > 50) return null;
 const result: Prescription[] = [];
 for (const entry of value) { const p = row(entry); if (!text(p.id) || !text(p.name) || !Number.isInteger(p.sets) || Number(p.sets) < 1 || Number(p.sets) > 20 || !Number.isInteger(p.reps) || Number(p.reps) < 1 || Number(p.reps) > 100) return null;
  result.push({ id: p.id as string, name: p.name as string, sets: Number(p.sets), reps: Number(p.reps), tracked: p.tracked === true && modelExercise(p.id as string) !== null }); }
 return result;
}
export async function fetchPlan(request: ApiRequest, zone: string, generate = false, signal?: AbortSignal) {
 const response = await request(`/plans/${generate ? 'generate' : 'current'}?tz=${encodeURIComponent(zone)}`, { method: generate ? 'POST' : 'GET', signal });
 if (!generate && response.status === 404) return null;
 const body = await response.json().catch(() => null);
 if (!response.ok) throw new Error(text(row(body).message) ?? 'Could not load your plan. Try again.');
 const plan = parsePlan(body); if (!plan) throw new Error('The plan could not be read. Try again.'); return plan;
}
let storage: import('react-native-mmkv').MMKV | undefined;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep native modules out of web SSR.
const native = () => storage ??= (require('react-native-mmkv') as typeof import('react-native-mmkv')).createMMKV({ id: 'weekly-plans' });
const key = (account: string, week: string) => `plan:${encodeURIComponent(account)}:${week}`;
const listeners = new Set<() => void>();
export function subscribePlans(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function readPlan(account: string, week: string): PlanCache | null {
 try { const k = key(account, week), raw = Platform.OS === 'web' ? typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null : native().getString(k), saved = row(JSON.parse(raw ?? 'null')), plan = parsePlan(saved.plan);
  if (!plan || plan.weekOf !== week) return null;
  const date = text(saved.selectedDate); return { plan, selectedDate: date && date >= week && date <= addPlanDays(week, 6) ? date : week };
 } catch { return null; }
}
export function savePlan(account: string, plan: WeeklyPlan, selectedDate: string) {
 const data = JSON.stringify({ plan: { ...plan, week_of: plan.weekOf, days: plan.days.map(d => ({ ...d, items: d.items.map(i => ({ ...i, id: i.itemId, exercise: { id: i.id, name: i.name, tracked: i.tracked } })) })) }, selectedDate }), k = key(account, plan.weekOf);
 if (Platform.OS === 'web') localStorage.setItem(k, data); else native().set(k, data); listeners.forEach(listener => listener());
}
export function selectPlanDate(account: string, week: string, date: string) { const saved = readPlan(account, week); if (saved && date >= week && date <= addPlanDays(week, 6)) savePlan(account, saved.plan, date); }

export function clearPlan(account: string, week: string) { const k = key(account, week); if (Platform.OS === 'web') localStorage.removeItem(k); else native().remove(k); listeners.forEach(listener => listener()); }
