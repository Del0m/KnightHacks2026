import type { ProfileRequest } from '@/screens/Onboarding/api';
export type BuddySuggestion = { user: { id: string; handle: string; display_name: string | null; gym_name: string | null; experience_level: string }; reasons: string[]; score: number };
export type BuddyMatch = { user_id: string; handle: string; status: 'requested' | 'accepted'; direction: 'incoming' | 'outgoing'; reasons: string[] };
export type MatchingPreferences = { gym_name: string | null; gym_place_id: string | null; schedule: string[] };
export type BuddyData = { suggestions: BuddySuggestion[]; matches: BuddyMatch[]; preferences: MatchingPreferences; hint: string | null };
export async function buddyResponse(response: Response) {
 let value;
 try { value = await response.json(); } catch { throw new Error('Buddies returned an unreadable response. Try again.'); }
 if (!response.ok) throw new Error(value?.message || 'Could not load buddies. Check your connection and try again.');
 return value;
}
export async function loadBuddies(request: ProfileRequest, signal: AbortSignal): Promise<BuddyData> {
 const [suggestions, matches, preferences] = await Promise.all(['/buddies/suggestions', '/buddies', '/me/profile'].map(async path => buddyResponse(await request(path, { signal }))));
 if (!Array.isArray(suggestions?.suggestions) || !Array.isArray(matches) || !Array.isArray(preferences?.schedule)) throw new Error('Could not read your buddies. Try again.');
 return { suggestions: suggestions.suggestions, matches, preferences, hint: suggestions.hint ?? null };
}
export async function buddyAction(request: ProfileRequest, id: string, action: 'request' | 'accept' | 'decline', signal: AbortSignal) {
 return buddyResponse(await request(`/buddies/${encodeURIComponent(id)}/${action}`, { method: 'POST', signal }));
}
export async function saveMatchingPreferences(request: ProfileRequest, draft: MatchingPreferences, signal: AbortSignal): Promise<MatchingPreferences> {
 if (!!draft.gym_name?.trim() !== !!draft.gym_place_id?.trim()) throw new Error('Enter both the gym name and its shared gym ID, or clear both.');
 return buddyResponse(await request('/me/profile', { method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gym_name: draft.gym_name?.trim() || null, gym_place_id: draft.gym_place_id?.trim() || null, schedule: draft.schedule }) }));
}
