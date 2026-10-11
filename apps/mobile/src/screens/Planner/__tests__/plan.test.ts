import { fetchPlan, parsePlan, routineForDay, weekStart, savePlan, readPlan, selectPlanDate, modelExercise } from '../plan';
const mockData = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: (k: string) => mockData.get(k), set: (k: string, v: string) => mockData.set(k, v) }) }));
const raw = { id: 'plan', week_of: '2026-10-05', notes: [], days: [{ day: 0, date: '2026-10-05', items: [{ id: 'item', position: 0, sets: 2, reps: 8, exercise: { id: 'squat', name: 'Squat', tracked: true }, sources: [{ id: 'exercise:squat#0', title: 'Squat guide' }], reason: 'Build strength', swap_note: 'Knee adaptation' }] }] };
beforeEach(() => mockData.clear());
it('keeps dates, prescriptions and source/swap information from the API', () => {
 const plan = parsePlan(raw)!;
 expect(plan.days[0].items[0].swapNote).toBe('Knee adaptation');
 expect(routineForDay(plan, '2026-10-05')).toEqual([{ id: 'squat', name: 'Squat', tracked: true, sets: 2, reps: 8 }]);
 expect(routineForDay(plan, '2026-10-06')).toEqual([]);
 expect(parsePlan({ ...raw, days: [{ ...raw.days[0], date: '2026-10-30' }] })).toBeNull();
});
it('isolates cached plans and selected dates by account and local week', () => {
 const plan = parsePlan(raw)!;
 savePlan('a', plan, '2026-10-05'); selectPlanDate('a', plan.weekOf, '2026-10-06');
 expect(readPlan('a', '2026-10-05')?.selectedDate).toBe('2026-10-06');
 expect(readPlan('b', '2026-10-05')).toBeNull(); expect(readPlan('a', '2026-10-12')).toBeNull();
});
it('uses Monday boundaries and never maps an unsupported exercise to curl', () => {
 expect(weekStart('2026-10-11')).toBe('2026-10-05'); expect(weekStart('2026-10-12')).toBe('2026-10-12');
 expect(modelExercise('bicep_curl')).toBe('curl'); expect(modelExercise('shoulder_press')).toBe('press'); expect(modelExercise('Dumbbell_Lunges')).toBeNull();
});
it('calls the real endpoints with a time zone and treats a missing week as empty', async () => {
 const request = jest.fn().mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce({ ok: true, json: async () => raw });
 expect(await fetchPlan(request, 'America/New_York')).toBeNull();
 expect(await fetchPlan(request, 'America/New_York', true)).toEqual(parsePlan(raw));
 expect(request.mock.calls[0][0]).toBe('/plans/current?tz=America%2FNew_York');
 expect(request.mock.calls[1][1].method).toBe('POST');
});
