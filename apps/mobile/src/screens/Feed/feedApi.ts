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


export type FeedComment = { id: string; body: string; created_at: string; author: { id: string | null; handle: string | null; display_name?: string | null } | null };
export async function fetchComments(request: ApiRequest, id: string, signal?: AbortSignal): Promise<FeedComment[]> {
 const response = await request(`/posts/${encodeURIComponent(id)}/comments`, { signal });
 if (!response.ok) throw new Error('Could not load comments. Try again.');
 const rows = await response.json();
 if (!Array.isArray(rows) || !rows.every(r => r && typeof r.id === 'string' && typeof r.body === 'string' && typeof r.created_at === 'string' && Number.isFinite(Date.parse(r.created_at)) && (r.author === null || r.author && (r.author.id === null || typeof r.author.id === 'string') && (r.author.handle === null || typeof r.author.handle === 'string')))) throw new Error('Could not read comments. Try again.');
 return rows;
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
export function createPost(request: ApiRequest, body: string) { return writePost(request, '/posts', { kind: 'goal', body: body.trim(), data: { post_type: 'custom' } }); }
export function createComment(request: ApiRequest, id: string, body: string) { return writePost(request, `/posts/${encodeURIComponent(id)}/comments`, { body: body.trim() }); }
