/* eslint-disable @typescript-eslint/no-require-imports -- Existing React renderer convention. */
import React from 'react';
import { FlatList, Text } from 'react-native';
import FeedScreen, { FeedCard } from '../index';
import { useAuth } from '@/screens/Auth/session';
const { act, create } = require('react-test-renderer');
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn().mockResolvedValue(undefined) }));
let mockFocused = true;
beforeEach(() => { mockFocused = true; });
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/AppPage', () => ({ AppPage: ({ children }: React.PropsWithChildren) => children, Action: 'Action', pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
const post = (id: string) => ({ id, kind: 'session', body: `Workout ${id}`, created_at: '2026-10-10T12:00:00Z', author: { id: 'sam', handle: 'sam' }, data: { tier: 'gold' }, kudos_count: 1, comment_count: 2, viewer_gave_kudos: false });
it('renders a shared workout with the author, medal, exercises and positive highlight', () => {
 let screen: ReturnType<typeof create>;
 const workout = { date: '2026-10-10', exercises: [{ id: 'squat', name: 'Squat', sets: 3, reps: 30 }], highlights: ['Squat: new rep best of 12 reps.'] };
 act(() => { screen = create(<FeedCard post={{ ...post('summary'), author: { id: 'sam', handle: 'sam', display_name: 'Sam' }, data: { tier: 'gold', workout } }} pending={false} onKudos={jest.fn()} />); });
 const text = screen.root.findAllByType(Text).map((n: any) => JSON.stringify(n.props.children)).join(' ');
 expect(text).toContain('Sam'); expect(text).toContain('Gold'); expect(text).toContain('Squat'); expect(text).toContain('30'); expect(text).toContain('new rep best');
 expect(text).not.toContain('Workout summary');
 act(() => screen.unmount());
});
it('loads cursor pages once, deduplicates overlapping posts, and refreshes from the beginning', async () => {
 const apiFetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('a')], next_cursor: 'next' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('a'), post('b')], next_cursor: null }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('c')], next_cursor: null }) });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 await act(async () => { const list = screen.root.findByType(FlatList); list.props.onEndReached(); list.props.onEndReached(); });
 expect(apiFetch).toHaveBeenCalledTimes(2);
 expect(apiFetch.mock.calls[1][0]).toBe('/feed?scope=public&cursor=next');
 expect(screen.root.findByType(FlatList).props.data.map((p: { id: string }) => p.id)).toEqual(['a', 'b']);
 await act(async () => { screen.root.findByType(FlatList).props.onRefresh(); });
 expect(screen.root.findByType(FlatList).props.data.map((p: { id: string }) => p.id)).toEqual(['c']);
 act(() => screen.unmount());
});
it('keeps loaded posts and offers retry when the next page fails', async () => {
 const apiFetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('a')], next_cursor: 'next' }) }).mockRejectedValueOnce(new Error('Offline'));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 await act(async () => { screen.root.findByType(FlatList).props.onEndReached(); });
 expect(screen.root.findByType(FlatList).props.data).toHaveLength(1);
 expect(screen.root.findAllByType(Text).some((n: { props: { children: unknown } }) => n.props.children === 'Offline')).toBe(true);
 act(() => screen.unmount());
});
it('discards an old account response when the feed account changes', async () => {
 let resolve!: (value: unknown) => void;
 const oldRequest = jest.fn().mockReturnValue(new Promise(r => { resolve = r; }));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'old' }, apiFetch: oldRequest } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 const newRequest = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [post('new')], next_cursor: null }) });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'new' }, apiFetch: newRequest } as never);
 await act(async () => { screen.update(<FeedScreen />); });
 await act(async () => { resolve({ ok: true, json: async () => ({ posts: [post('private-old')], next_cursor: null }) }); });
 expect(screen.root.findByType(FlatList).props.data.map((p: { id: string }) => p.id)).toEqual(['new']);
 act(() => screen.unmount());
});
it('does not double-count kudos already included by a concurrent refresh', async () => {
 let release!: (value: unknown) => void;
 let page = post('a');
 const apiFetch = jest.fn().mockImplementation((path: string) => path.endsWith('/kudos') ? new Promise(r => { release = r; }) : Promise.resolve({ ok: true, json: async () => ({ posts: [page], next_cursor: null }) }));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 act(() => screen.root.findAllByType('Button').find((n: any) => n.props.accessibilityLabel === 'Rep post, 1').props.onPress());
 page = { ...page, kudos_count: 2, viewer_gave_kudos: true };
 await act(async () => { screen.root.findByType(FlatList).props.onRefresh(); });
 await act(async () => { release({ ok: true }); });
 expect(screen.root.findByType(FlatList).props.data[0].kudos_count).toBe(2);
 act(() => screen.unmount());
});

it('previews ten examples without publishing and filters them by type', async () => {
 const apiFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: [], next_cursor: null }) });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 const press = (label: string) => act(() => screen.root.findAllByType('Button').find((n: any) => n.props.accessibilityLabel === label || n.findAllByType(Text).some((t: any) => t.props.children === label)).props.onPress());
 press('Filter feed'); press('Preview 10 examples');
 expect(screen.root.findByType(FlatList).props.data).toHaveLength(10);
 const calls = apiFetch.mock.calls.length;
 press('Rep post, 12');
 expect(screen.root.findByType(FlatList).props.data[0].viewer_gave_kudos).toBe(true);
 expect(apiFetch.mock.calls).toHaveLength(calls);
 press('Filter feed'); press('Personal records');
 expect(screen.root.findByType(FlatList).props.data).toHaveLength(3);
 expect(screen.root.findByType(FlatList).props.data.every((p: any) => p.kind === 'pr')).toBe(true);
 act(() => screen.unmount());
});

it('keeps the mounted paginated list on refocus and refreshes without resetting its cursor', async () => {
 let resolve!: (value: unknown) => void;
 const apiFetch = jest.fn()
  .mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('a')], next_cursor: 'page-two' }) })
  .mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('b')], next_cursor: 'page-three' }) })
  .mockReturnValueOnce(new Promise(r => { resolve = r; }))
  .mockResolvedValueOnce({ ok: true, json: async () => ({ posts: [post('c')], next_cursor: null }) });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 await act(async () => { screen.root.findByType(FlatList).props.onEndReached(); });
 const list = screen.root.findByType(FlatList);
 mockFocused = false;
 await act(async () => { screen.update(<FeedScreen />); });
 mockFocused = true;
 await act(async () => { screen.update(<FeedScreen />); });
 expect(screen.root.findByType(FlatList)).toBe(list);
 expect(list.props.refreshing).toBe(false);
 expect(list.props.data.map((p: { id: string }) => p.id)).toEqual(['a', 'b']);
 await act(async () => { resolve({ ok: true, json: async () => ({ posts: [{ ...post('a'), kudos_count: 5 }], next_cursor: 'page-two' }) }); });
 expect(list.props.data.map((p: { id: string }) => p.id)).toEqual(['a', 'b']);
 expect(list.props.data[0].kudos_count).toBe(5);
 await act(async () => { list.props.onEndReached(); });
 expect(apiFetch.mock.calls[3][0]).toBe('/feed?scope=public&cursor=page-three');
 act(() => screen.unmount());
});

it('fills the gap between new pages and cached posts on refocus', async () => {
 const response = (ids: string[], cursor: string | null) => ({ ok: true, json: async () => ({ posts: ids.map(post), next_cursor: cursor }) });
 const apiFetch = jest.fn()
  .mockResolvedValueOnce(response(['old'], 'old-tail'))
  .mockResolvedValueOnce(response(['newest'], 'new-page'))
  .mockResolvedValueOnce(response(['newer', 'old'], 'overlap-tail'))
  .mockResolvedValueOnce(response(['older'], null));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 mockFocused = false;
 await act(async () => { screen.update(<FeedScreen />); });
 mockFocused = true;
 await act(async () => { screen.update(<FeedScreen />); });
 expect(apiFetch.mock.calls[2][0]).toBe('/feed?scope=public&cursor=new-page');
 const list = screen.root.findByType(FlatList);
 expect(list.props.data.map((p: { id: string }) => p.id)).toEqual(['newest', 'newer', 'old']);
 await act(async () => { list.props.onEndReached(); });
 expect(apiFetch.mock.calls[3][0]).toBe('/feed?scope=public&cursor=overlap-tail');
 act(() => screen.unmount());
});

it.each([
 { initial: ['removed', 'kept'], next: null, freshNext: null, expected: ['kept'], expectedCursor: null },
 { initial: ['removed', 'kept', 'older'], next: 'old-tail', freshNext: 'fresh-tail', expected: ['kept', 'older'], expectedCursor: 'old-tail' },
])('replaces the refreshed cache prefix and preserves only untouched older entries: $initial', async ({ initial, next, freshNext, expected, expectedCursor }) => {
 const response = (ids: string[], cursor: string | null) => ({ ok: true, json: async () => ({ posts: ids.map(post), next_cursor: cursor }) });
 const apiFetch = jest.fn()
  .mockResolvedValueOnce(response(initial, next))
  .mockResolvedValueOnce(response(['kept'], freshNext))
  .mockResolvedValueOnce(response(['last'], null));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch } as never);
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedScreen />); });
 mockFocused = false;
 await act(async () => { screen.update(<FeedScreen />); });
 mockFocused = true;
 await act(async () => { screen.update(<FeedScreen />); });
 const list = screen.root.findByType(FlatList);
 try {
  expect(list.props.data.map((p: { id: string }) => p.id)).toEqual(expected);
  await act(async () => { list.props.onEndReached(); });
  if (expectedCursor) expect(apiFetch.mock.calls[2][0]).toBe(`/feed?scope=public&cursor=${expectedCursor}`);
  else expect(apiFetch).toHaveBeenCalledTimes(2);
 } finally { act(() => screen.unmount()); }
});
