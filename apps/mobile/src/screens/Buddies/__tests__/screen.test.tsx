/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer convention. */
import React from 'react';
import { Text, TextInput } from 'react-native';
import BuddiesScreen from '../index';
import { useAuth } from '@/screens/Auth/session';
const { act, create } = require('react-test-renderer');
let mockFocused = true;
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: (cb: () => void) => require('react').useEffect(() => mockFocused ? cb() : undefined, [cb, mockFocused]) }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('@/state/Training', () => ({ useTraining: () => ({ profile: { buddyTime: 'Mornings' }, updateProfile: jest.fn() }) }));
jest.mock('@/components/AppPage', () => ({ AppPage: ({ children, headerAction }: React.PropsWithChildren<{ headerAction?: React.ReactNode }>) => <>{headerAction}{children}</>, Action: 'Action', pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
const profile = { gym_name: 'Campus Gym', gym_place_id: 'campus', schedule: ['mon_am'], experience_level: 'beginner' };
const suggestion = { user: { id: 'sam', handle: 'sam', display_name: 'Sam', gym_name: 'Campus Gym', experience_level: 'beginner' }, reasons: ['Same gym: Campus Gym', 'Both train Monday mornings'], score: .9 };
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function api(extra?: (path: string, options?: RequestInit) => unknown) {
 return jest.fn().mockImplementation((path: string, options?: RequestInit) => extra?.(path, options) ?? Promise.resolve(response(path === '/me/profile' ? profile : path === '/buddies/suggestions' ? { suggestions: [suggestion], hint: null } : [])));
}
function texts(screen: ReturnType<typeof create>) { return screen.root.findAllByType(Text).map((n: any) => JSON.stringify(n.props.children)).join(' '); }
const button = (screen: ReturnType<typeof create>, label: string) => screen.root.findAllByType('Button').find((n: any) => n.props.accessibilityLabel === label);
beforeEach(() => { mockFocused = true; });
it('loads real suggestions and shows their names and matching reasons', async () => {
 const request = api(); jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 expect(texts(screen)).toContain('Sam'); expect(texts(screen)).toContain('Both train Monday mornings');
 expect(request.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['/buddies', '/buddies/suggestions', '/me/profile']));
 act(() => screen.unmount());
});
it('sends a stable request once while pending and moves it to outgoing', async () => {
 let resolve!: (value: unknown) => void; let requested = false;
 const request = api((path, options) => {
  if (options?.method === 'POST') return new Promise(r => { resolve = r; requested = true; });
  if (path === '/buddies') return Promise.resolve(response(requested ? [{ user_id: 'sam', handle: 'sam', status: 'requested', direction: 'outgoing', reasons: suggestion.reasons }] : []));
  if (path === '/buddies/suggestions' && requested) return Promise.resolve(response({ suggestions: [], hint: null }));
 });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 act(() => { const press = button(screen, 'Request Sam').props.onPress; press(); press(); });
 expect(request.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
 expect(request.mock.calls.find(c => c[1]?.method === 'POST')?.[0]).toBe('/buddies/sam/request');
 await act(async () => { resolve(response({ status: 'requested' })); });
 act(() => screen.root.findAllByType('Choice').find((n: any) => n.props.label === 'Outgoing').props.onPress());
 expect(texts(screen)).toContain('Request sent'); act(() => screen.unmount());
});
it.each(['accept', 'decline'])('uses the incoming requester id to %s and refreshes the list', async action => {
 let pending = true;
 const request = api((path, options) => {
  if (options?.method === 'POST') { pending = false; return Promise.resolve(response({ status: action === 'accept' ? 'accepted' : 'declined' })); }
  if (path === '/buddies') return Promise.resolve(response(pending ? [{ user_id: 'sam', handle: 'sam', direction: 'incoming', status: 'requested', reasons: [] }] : []));
 });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 act(() => screen.root.findAllByType('Choice').find((n: any) => n.props.label === 'Incoming').props.onPress());
 await act(async () => { button(screen, `${action === 'accept' ? 'Accept' : 'Decline'} sam`).props.onPress(); });
 expect(request.mock.calls.some(c => c[0] === `/buddies/sam/${action}` && c[1]?.method === 'POST')).toBe(true);
 expect(texts(screen)).toContain('No incoming requests'); act(() => screen.unmount());
});
it('discards account responses after switching accounts', async () => {
 let release!: (value: unknown) => void;
 const old = api(path => path === '/buddies/suggestions' ? new Promise(r => { release = r; }) : undefined);
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'old' }, apiFetch: old } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'new' }, apiFetch: api(path => path === '/buddies/suggestions' ? Promise.resolve(response({ suggestions: [], hint: null })) : undefined) } as never);
 await act(async () => { screen.update(<BuddiesScreen />); });
 await act(async () => { release(response({ suggestions: [suggestion], hint: null })); });
 expect(texts(screen)).not.toContain('Sam'); act(() => screen.unmount());
});
it('saves gym and day/time slots without coordinates or private injury fields', async () => {
 const request = api((path, options) => options?.method === 'PUT' ? Promise.resolve(response({ ...profile, ...JSON.parse(String(options.body)) })) : undefined);
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 act(() => button(screen, 'Edit matching preferences').props.onPress());
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === 'Gym name').props.onChangeText('Downtown Gym'));
 await act(async () => { screen.root.findByType('Action').props.onPress(); });
 const sent = JSON.parse(request.mock.calls.find(c => c[1]?.method === 'PUT')?.[1].body);
 expect(sent).toEqual({ gym_name: 'Downtown Gym', gym_place_id: 'campus', schedule: ['mon_am'] });
 act(() => screen.unmount());
});
it('keeps loaded suggestions during an offline refresh with a retry', async () => {
 const request = api(); jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 request.mockRejectedValue(new Error('Offline'));
 await act(async () => { button(screen, 'Refresh buddies').props.onPress(); });
 expect(texts(screen)).toContain('Sam'); expect(texts(screen)).toContain('Offline'); expect(screen.root.findAllByType('Action').length).toBe(1);
 act(() => screen.unmount());
});
it('preserves preference edits after a failed save and retries the same answers', async () => {
 let fail = true;
 const request = api((_path, options) => options?.method === 'PUT' ? fail ? Promise.reject(new Error('Offline')) : Promise.resolve(response({ ...profile, ...JSON.parse(String(options.body)) })) : undefined);
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 act(() => button(screen, 'Edit matching preferences').props.onPress());
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === 'Gym name').props.onChangeText('Updated Gym'));
 await act(async () => { screen.root.findByType('Action').props.onPress(); });
 expect(screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === 'Gym name').props.value).toBe('Updated Gym');
 fail = false;
 await act(async () => { screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Save preferences').props.onPress(); });
 expect(request.mock.calls.filter(c => c[1]?.method === 'PUT').map(c => JSON.parse(c[1].body).gym_name)).toEqual(['Updated Gym', 'Updated Gym']);
 act(() => screen.unmount());
});
it('clears private drafts and suggestions when signing out without making a write', async () => {
 const request = api(); jest.mocked(useAuth).mockReturnValue({ user: { id: 'one' }, apiFetch: request } as never);
 let screen: ReturnType<typeof create>; await act(async () => { screen = create(<BuddiesScreen />); });
 act(() => button(screen, 'Edit matching preferences').props.onPress());
 jest.mocked(useAuth).mockReturnValue({ user: null, apiFetch: request } as never);
 await act(async () => screen.update(<BuddiesScreen />));
 expect(screen.root.findAllByType(TextInput)).toHaveLength(0); expect(texts(screen)).not.toContain('Sam'); expect(texts(screen)).toContain('Log in');
 expect(request.mock.calls.some(c => c[1]?.method === 'POST' || c[1]?.method === 'PUT')).toBe(false); act(() => screen.unmount());
});
