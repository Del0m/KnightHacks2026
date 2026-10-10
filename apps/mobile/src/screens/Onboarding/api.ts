import { createDraft, parseProfile, profilePayload, validateStep, type Draft } from './model';

export type ProfileRequest = (path: string, options?: RequestInit) => Promise<Response>;
async function readResponse(response: Response) {
  if (!response.ok) throw new Error('Could not save your profile. Your answers are still here. Please try again.');
  try { return await response.json(); } catch { throw new Error('The profile service returned an unreadable response. Please try again.'); }
}
function fromApi(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!['beginner', 'intermediate', 'advanced'].includes(String(p.experience_level)) || !Array.isArray(p.schedule)) return null;
  if (p.injury_note !== null && typeof p.injury_note !== 'string') return null;
  return parseProfile({ ...p, experience_level: p.experience_level === 'intermediate' ? 'experienced' : p.experience_level,
    schedule: p.training_schedule ?? { kind: 'weekly', days: p.schedule.length ? [...new Set(p.schedule.map(slot => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(String(slot).split('_')[0])))] : createDraft().days },
    injury_note: p.injury_note ?? '' });
}
export async function loadProfile(request: ProfileRequest) {
  const response = await request('/me/profile');
  if (response.status === 404) return null;
  const profile = fromApi(await readResponse(response));
  if (!profile) throw new Error('Could not load your training settings. Please try again.');
  return profile;
}
export async function saveOnboarding(request: ProfileRequest, draft: Draft) {
  for (let step = 0; step < 4; step++) { const error = validateStep(draft, step); if (error) throw new Error(error); }
  const payload = profilePayload(draft, true);
  const body = { goals: payload.goals, experience_level: payload.experience_level === 'experienced' ? 'intermediate' : payload.experience_level,
    personal_bests: payload.personal_bests, training_schedule: payload.schedule, onboarding_completed: true, injury_note: draft.injury.trim() };
  // BE-03 saves the profile and its private free-text injury in one transaction.
  const saved = fromApi(await readResponse(await request('/me/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
  const sameSchedule = saved && saved.schedule.kind === payload.schedule.kind && (saved.schedule.kind === 'weekly' && payload.schedule.kind === 'weekly'
    ? saved.schedule.days.length === payload.schedule.days.length && payload.schedule.days.every(day => saved.schedule.kind === 'weekly' && saved.schedule.days.includes(day))
    : saved.schedule.kind === 'interval' && payload.schedule.kind === 'interval' && saved.schedule.every_days === payload.schedule.every_days && saved.schedule.start_date === payload.schedule.start_date);
  if (!saved || !sameSchedule || !saved.onboarding_completed || saved.injury_note !== body.injury_note || saved.experience_level !== payload.experience_level || saved.goals.length !== payload.goals.length || !payload.goals.every(goal => saved.goals.includes(goal)) || saved.personal_bests.length !== payload.personal_bests.length || !payload.personal_bests.every(best => saved.personal_bests.some(pb => pb.exercise === best.exercise && pb.weight === best.weight && pb.unit === best.unit && pb.reps === best.reps))) throw new Error('Your setup hasn’t been confirmed. Your answers are still here. Please try again.');
  return saved;
}
