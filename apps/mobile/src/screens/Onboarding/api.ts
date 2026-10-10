import { parseProfile, profilePayload, validateStep, type Draft } from './model';

export type ProfileRequest = (path: string, options?: RequestInit) => Promise<Response>;
async function readResponse(response: Response) {
  if (!response.ok) {
    if ([404, 405, 501].includes(response.status)) throw new Error('Profile saving isn’t connected yet. Your answers are still here; try again when it’s available.');
    throw new Error('Could not save your profile. Your answers are still here. Please try again.');
  }
  try { return await response.json(); } catch { throw new Error('The profile service returned an unreadable response. Please try again.'); }
}
export async function loadProfile(request: ProfileRequest) {
  const response = await request('/me/profile');
  if (response.status === 404) return null;
  const profile = parseProfile(await readResponse(response));
  if (!profile) throw new Error('The profile service doesn’t support this setup yet. You can keep training and retry later.');
  return profile;
}
/** BE-03 is not implemented locally. See Markdown/FE-03-FE-04-Implementation.md for this proposed contract. */
export async function saveOnboarding(request: ProfileRequest, draft: Draft) {
  for (let step = 0; step < 4; step++) { const error = validateStep(draft, step); if (error) throw new Error(error); }
  const put = async (completed: boolean) => {
    const payload = profilePayload(draft, completed);
    const response = await request('/me/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const profile = parseProfile(await readResponse(response));
    const sameSchedule = profile && profile.schedule.kind === payload.schedule.kind && (profile.schedule.kind === 'weekly' && payload.schedule.kind === 'weekly'
      ? profile.schedule.days.length === payload.schedule.days.length && payload.schedule.days.every(day => profile.schedule.kind === 'weekly' && profile.schedule.days.includes(day))
      : profile.schedule.kind === 'interval' && payload.schedule.kind === 'interval' && profile.schedule.every_days === payload.schedule.every_days && profile.schedule.start_date === payload.schedule.start_date);
    if (!profile || !sameSchedule || profile.onboarding_completed !== completed || profile.experience_level !== payload.experience_level || profile.goals.length !== payload.goals.length || !payload.goals.every(goal => profile.goals.includes(goal)) || profile.personal_bests.length !== payload.personal_bests.length || !payload.personal_bests.every(best => profile.personal_bests.some(saved => saved.exercise === best.exercise && saved.weight === best.weight && saved.unit === best.unit && saved.reps === best.reps))) throw new Error('The profile service hasn’t confirmed your setup. Your answers are still here.');
    return profile;
  };
  await put(false);
  if (draft.injury.trim()) {
    const injuries = await readResponse(await request('/me/injuries'));
    if (!Array.isArray(injuries) || injuries.some(i => !i || typeof i.description !== 'string')) throw new Error('The injury service doesn’t support free-text notes yet. Your answers are still here.');
    // Reconcile before POST so a retry after an ambiguous response does not duplicate a saved note.
    if (!injuries.some(i => i.description.trim() === draft.injury.trim())) {
      const saved = await readResponse(await request('/me/injuries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: draft.injury.trim() }) }));
      if (!saved || typeof saved.description !== 'string' || saved.description.trim() !== draft.injury.trim()) throw new Error('The injury service hasn’t confirmed your note. Your answers are still here. Please try again.');
    }
  }
  return put(true);
}
