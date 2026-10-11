import type { ApiRequest } from '@/services/workoutApi';
export type FeedPost = { id: string; kind: string; body: string; created_at: string; author: { id: string; handle: string | null; display_name?: string | null }; data: Record<string, unknown> | null; kudos_count: number; comment_count: number; viewer_gave_kudos: boolean };
export type FeedPage = { posts: FeedPost[]; next_cursor: string | null };
export async function fetchFeed(request: ApiRequest, cursor?: string, signal?: AbortSignal): Promise<FeedPage> {
 const response = await request(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
 if (!response.ok) throw new Error('Could not load the feed. Try again.');
 const page = await response.json() as FeedPage;
 if (!page || !Array.isArray(page.posts) || !(page.next_cursor === null || typeof page.next_cursor === 'string') || !page.posts.every(p => p && typeof p.id === 'string' && typeof p.body === 'string' && ['session', 'pr', 'medal', 'goal', 'advice'].includes(p.kind) && typeof p.created_at === 'string' && Number.isFinite(Date.parse(p.created_at)) && p.author && typeof p.author.id === 'string' && (p.author.handle === null || typeof p.author.handle === 'string') && Number.isInteger(p.kudos_count) && p.kudos_count >= 0 && Number.isInteger(p.comment_count) && p.comment_count >= 0 && typeof p.viewer_gave_kudos === 'boolean' && (p.data === null || typeof p.data === 'object'))) throw new Error('Could not read the feed. Try again.');
 return page;
}
export async function toggleKudos(request: ApiRequest, id: string, gave: boolean) {
 const response = await request(`/posts/${encodeURIComponent(id)}/kudos`, { method: gave ? 'DELETE' : 'POST' });
 if (!response.ok) throw new Error('Could not update kudos. Try again.');
}
export function isGoldWorkout(post: FeedPost) { return ['session', 'medal'].includes(post.kind) && (post.data?.tier === 'gold' || post.data?.medal === 'gold'); }
