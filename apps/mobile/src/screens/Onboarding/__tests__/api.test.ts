import { loadProfile, saveOnboarding } from '../api';
import { createDraft } from '../model';
const draft = { ...createDraft(), goals: ['muscle', 'strength', 'core'], experience: 'experienced' as const, unknownBests: true, injury: 'My left knee bothers me.' };
const response = (body: object) => new Response(JSON.stringify({ schedule: [], ...body }));
test('saves BE-03 casing, level and cadence, and confirms the private note', async () => {
  const request = jest.fn(async (_path: string, init?: RequestInit) => response(JSON.parse(String(init?.body))));
  const saved = await saveOnboarding(request, draft);
  expect(saved.experience_level).toBe('experienced');
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ experience_level: 'intermediate', training_schedule: { kind: 'weekly', days: [1, 3, 5] }, injury_note: draft.injury });
});
test('loads a new account and restores injury notes and interval schedules', async () => {
  const fresh = await loadProfile(async () => response({ goals: [], experience_level: 'beginner', personal_bests: [], training_schedule: null, onboarding_completed: false, injury_note: null }));
  expect(fresh?.onboarding_completed).toBe(false);
  const interval = { ...draft, scheduleMode: 'interval' as const };
  const saved = await saveOnboarding(async (_path, init) => response(JSON.parse(String(init?.body))), interval);
  expect(saved.schedule).toEqual({ kind: 'interval', every_days: 3, start_date: draft.startDate });
  expect(saved.injury_note).toBe(draft.injury);
});
test('failed or ignored writes never count as completion', async () => {
  await expect(saveOnboarding(async () => new Response('{}'), draft)).rejects.toThrow();
  await expect(saveOnboarding(async () => new Response('', { status: 400 }), draft)).rejects.toThrow();
  await expect(saveOnboarding(async (_path, init) => response({ ...JSON.parse(String(init?.body)), injury_note: '' }), draft)).rejects.toThrow();
});
