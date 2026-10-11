import { fetchFeed, toggleKudos, isGoldWorkout, createPost, fetchComments, createComment } from '../feedApi';
const post = { id: 'one', kind: 'session', body: 'Workout done.', created_at: '2026-10-10T12:00:00Z', author: { id: 'user', handle: 'sam', display_name: 'Sam' }, data: { tier: 'gold' }, kudos_count: 3, comment_count: 2, viewer_gave_kudos: false };
it('uses the opaque backend cursor and preserves snake-case counts', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [post], next_cursor: 'next/+=' }) });
 expect(await fetchFeed(request, 'cursor/+=' )).toEqual({ posts: [post], next_cursor: 'next/+=' });
 expect(request.mock.calls[0][0]).toBe('/feed?scope=public&cursor=cursor%2F%2B%3D');
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

it('requests public posts without requiring follows and explains network failures', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [post], next_cursor: null }) });
 await fetchFeed(request);
 expect(request.mock.calls[0][0]).toBe('/feed?scope=public');
 request.mockRejectedValue(new TypeError('Network request failed'));
 await expect(fetchFeed(request)).rejects.toThrow('Could not reach the workout server');
});

it('filters on the server and creates custom posts/comments with moderated errors', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [], next_cursor: null }) });
 await fetchFeed(request, 'older', undefined, 'pr');
 expect(request.mock.calls[0][0]).toBe('/feed?scope=public&type=pr&cursor=older');
 request.mockResolvedValue({ ok: true, json: async () => ({ id: 'made', body: 'Leg day', created_at: '2026-10-10T12:00:00Z' }) });
 await createPost(request, '  Leg day  ');
 expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ kind: 'goal', body: 'Leg day', data: { post_type: 'custom' } });
 await createComment(request, 'post-one', '  Nice work!  ');
 expect(request.mock.calls[2][0]).toBe('/posts/post-one/comments');
 expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ body: 'Nice work!' });
 request.mockResolvedValue({ ok: true, json: async () => [{ id: 'c', body: 'Nice work!', created_at: '2026-10-10T12:00:00Z', author: { id: 'sam', handle: 'sam', display_name: 'Sam' } }] });
 expect((await fetchComments(request, 'post-one'))[0].author?.display_name).toBe('Sam');
 request.mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'Please keep it kind.' }) });
 await expect(createComment(request, 'post-one', 'blocked')).rejects.toThrow('Please keep it kind.');
});
