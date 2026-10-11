import { fetchFeed, toggleKudos, isGoldWorkout } from '../feedApi';
const post = { id: 'one', kind: 'session', body: 'Workout done.', created_at: '2026-10-10T12:00:00Z', author: { id: 'user', handle: 'sam', display_name: 'Sam' }, data: { tier: 'gold' }, kudos_count: 3, comment_count: 2, viewer_gave_kudos: false };
it('uses the opaque backend cursor and preserves snake-case counts', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [post], next_cursor: 'next/+=' }) });
 expect(await fetchFeed(request, 'cursor/+=' )).toEqual({ posts: [post], next_cursor: 'next/+=' });
 expect(request.mock.calls[0][0]).toBe('/feed?cursor=cursor%2F%2B%3D');
 expect(isGoldWorkout(post)).toBe(true);
 expect(isGoldWorkout({ ...post, kind: 'goal' })).toBe(false);
});
it('supports giving and removing kudos, and surfaces a failed request', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true });
 await toggleKudos(request, 'one', false); await toggleKudos(request, 'one', true);
 expect(request.mock.calls.map(c => c[1].method)).toEqual(['POST', 'DELETE']);
 request.mockResolvedValue({ ok: false });
 await expect(fetchFeed(request)).rejects.toThrow();
});
it('rejects malformed feed pages instead of rendering invalid counts', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [{ ...post, kudos_count: -1 }], next_cursor: null }) });
 await expect(fetchFeed(request)).rejects.toThrow();
});
