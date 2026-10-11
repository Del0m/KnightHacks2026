import type { ApiRequest } from '@/services/workoutApi';
export type FeedPost = { id: string; kind: string; body: string; created_at: string; author: { id: string; handle: string | null; display_name?: string | null }; data: Record<string, unknown> | null; kudos_count: number; comment_count: number; viewer_gave_kudos: boolean };
export type FeedType = 'recent' | 'custom' | 'medal' | 'pr';
export const postType = (post: FeedPost): Exclude<FeedType, 'recent'> => post.kind === 'pr' ? 'pr' : ['session', 'medal'].includes(post.kind) ? 'medal' : 'custom';
export function medalTier(post: FeedPost): 'bronze' | 'silver' | 'gold' | null { const tier = post.data?.tier ?? post.data?.medal; return tier === 'gold' || tier === 'silver' || tier === 'bronze' ? tier : null; }
export type FeedPage = { posts: FeedPost[]; next_cursor: string | null };
export async function fetchFeed(request: ApiRequest, cursor?: string, signal?: AbortSignal, type: FeedType = 'recent'): Promise<FeedPage> {
 let response: Response;
 try { response = await request(`/feed?scope=public${type !== 'recent' ? `&type=${type}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }); }
 catch (error) {
  if (error instanceof TypeError && !signal?.aborted) throw new Error('Could not reach the workout server. Check your connection and try again.');
  throw error;
 }
 if (!response.ok) throw new Error(response.status >= 500 ? 'The workout server is unavailable. Try again shortly.' : response.status === 401 ? 'Your login has expired. Log in again to load Feed.' : 'Could not load the feed. Try again.');
 const page = await response.json() as FeedPage;
 if (!page || !Array.isArray(page.posts) || !(page.next_cursor === null || typeof page.next_cursor === 'string') || !page.posts.every(p => p && typeof p.id === 'string' && typeof p.body === 'string' && ['session', 'pr', 'medal', 'goal', 'advice'].includes(p.kind) && typeof p.created_at === 'string' && Number.isFinite(Date.parse(p.created_at)) && p.author && typeof p.author.id === 'string' && (p.author.handle === null || typeof p.author.handle === 'string') && Number.isInteger(p.kudos_count) && p.kudos_count >= 0 && Number.isInteger(p.comment_count) && p.comment_count >= 0 && typeof p.viewer_gave_kudos === 'boolean' && (p.data === null || typeof p.data === 'object'))) throw new Error('Could not read the feed. Try again.');
 return page;
}
export async function toggleKudos(request: ApiRequest, id: string, gave: boolean) {
 const response = await request(`/posts/${encodeURIComponent(id)}/kudos`, { method: gave ? 'DELETE' : 'POST' });
 if (!response.ok) throw new Error('Could not update rep. Try again.');
}
export function isGoldWorkout(post: FeedPost) { return ['session', 'medal'].includes(post.kind) && (post.data?.tier === 'gold' || post.data?.medal === 'gold'); }


export type AdviceSource = { id: string; title: string; kind: string; url?: string | null; post_id?: string | null };
function readSources(value: unknown): AdviceSource[] | null {
 return Array.isArray(value) ? value.filter((s): s is AdviceSource => s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.kind === 'string' && (s.url == null || typeof s.url === 'string') && (s.post_id == null || typeof s.post_id === 'string')) : null;
}
export type FeedComment = { sources?: AdviceSource[] | null; ai_suggested?: boolean; id: string; body: string; created_at: string; author: { id: string | null; handle: string | null; display_name?: string | null } | null };
export async function fetchComments(request: ApiRequest, id: string, signal?: AbortSignal): Promise<FeedComment[]> {
 const response = await request(`/posts/${encodeURIComponent(id)}/comments`, { signal });
 if (!response.ok) throw new Error('Could not load comments. Try again.');
 const rows = await response.json();
 if (!Array.isArray(rows) || !rows.every(r => r && typeof r.id === 'string' && typeof r.body === 'string' && (r.ai_suggested === undefined || typeof r.ai_suggested === 'boolean') && typeof r.created_at === 'string' && Number.isFinite(Date.parse(r.created_at)) && (r.author === null || r.author && (r.author.id === null || typeof r.author.id === 'string') && (r.author.handle === null || typeof r.author.handle === 'string')))) throw new Error('Could not read comments. Try again.');
 return rows.map(row => ({ ...row, sources: readSources(row.sources) }));
}
async function writePost(request: ApiRequest, path: string, body: object) {
 const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 if (!response.ok) {
  let message = 'Could not post. Try again.';
  try { const result = await response.json(); if (typeof result.message === 'string') message = result.message; } catch { /* Retain fallback for a non-JSON server failure. */ }
  throw new Error(message);
 }
 return response.json();
}
export function createPost(request: ApiRequest, body: string, title = '') { return writePost(request, '/posts', { ...(title.trim() ? { title: title.trim() } : {}), kind: 'goal', body: body.trim(), data: { post_type: 'custom' } }); }
export function createComment(request: ApiRequest, id: string, body: string) { return writePost(request, `/posts/${encodeURIComponent(id)}/comments`, { body: body.trim() }); }

export type AdviceResult = { post: { id: string; body: string; created_at: string; author_id: string }; outcome: 'ai' | 'fixed_pain' | 'none'; reply: FeedComment | null };
export async function createAdvice(request: ApiRequest, body: string): Promise<AdviceResult> {
 const result = await writePost(request, '/advice', { body: body.trim() });
 if (!result?.post || typeof result.post.id !== 'string' || typeof result.post.body !== 'string' || typeof result.post.author_id !== 'string' || !Number.isFinite(Date.parse(result.post.created_at)) || !['ai', 'fixed_pain', 'none'].includes(result.outcome) || (result.outcome !== 'none' && (!result.reply || typeof result.reply.id !== 'string' || typeof result.reply.body !== 'string' || !Number.isFinite(Date.parse(result.reply.created_at))))) throw new Error('The question may have been posted. Refresh Feed before trying again.');
 return { ...result, reply: result.outcome === 'none' ? null : { ...result.reply, author: null, sources: readSources(result.reply.sources) } };
}
export function sourceUrl(value: unknown): string | null {
 if (typeof value !== 'string') return null;
 try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
