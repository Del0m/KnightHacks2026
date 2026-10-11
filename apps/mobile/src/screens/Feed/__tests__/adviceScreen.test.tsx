/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer convention. */
import React from 'react';
import { Text, TextInput, FlatList } from 'react-native';
import FeedScreen from '../index';
import { useAuth } from '@/screens/Auth/session';
const { act, create } = require('react-test-renderer');
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/AppPage', () => ({ AppPage: ({ children }: React.PropsWithChildren) => children, Action: 'Action', pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
it('opens the new advice thread and first answer without waiting for a feed refresh', async () => {
 let finishComments!: (r: any) => void;
 const question = { id: 'question', kind: 'advice', author_id: 'me', body: 'How do I improve curls?', created_at: '2026-10-11T00:00:00Z' };
 const apiFetch = jest.fn().mockImplementation((path: string) => Promise.resolve(path === '/advice' ? { ok: true, json: async () => ({ post: question, outcome: 'fixed_pain', reply: { id: 'answer', body: 'See a doctor or physio.', created_at: question.created_at, ai_suggested: false } }) } : path.includes('/comments') ? new Promise(r => { finishComments = r; }) : { ok: true, json: async () => ({ posts: [], next_cursor: null }) }));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'me', name: 'Sam' }, apiFetch } as never);
 let screen: any; await act(async () => { screen = create(<FeedScreen />); });
 act(() => screen.root.findAllByType('Button').find((n: any) => n.props.accessibilityLabel === 'Ask for advice').props.onPress());
 act(() => screen.root.findByType(TextInput).props.onChangeText(question.body));
 await act(async () => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Ask the community').props.onPress());
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'See a doctor or physio.')).toBe(true);
 expect(screen.root.findByType(FlatList).props.data[0].kind).toBe('advice');
 await act(async () => finishComments({ ok: true, json: async () => [] }));
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'See a doctor or physio.')).toBe(true);
 act(() => screen.unmount());
});
it('makes advice questions recognizable in feed cards', async () => {
 const { FeedCard } = require('../FeedCard'); let screen: any;
 await act(async () => { screen = create(<FeedCard post={{ id: 'q', kind: 'advice', body: 'How can I improve?', created_at: '2026-10-11T00:00:00Z', author: { id: 'sam', handle: 'sam' }, data: null, kudos_count: 0, comment_count: 0, viewer_gave_kudos: false }} pending={false} onKudos={jest.fn()} />); });
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'Advice question')).toBe(true); act(() => screen.unmount());
});
it('does not show a previous account question after switching accounts during submission', async () => {
 let finish!: (r: any) => void;
 const apiFetch = jest.fn().mockImplementation((path: string) => path === '/advice' ? new Promise(r => { finish = r; }) : Promise.resolve({ ok: true, json: async () => ({ posts: [], next_cursor: null }) }));
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'old', name: 'Old' }, apiFetch } as never);
 let screen: any; await act(async () => { screen = create(<FeedScreen />); });
 act(() => screen.root.findAllByType('Button').find((n: any) => n.props.accessibilityLabel === 'Ask for advice').props.onPress());
 act(() => screen.root.findByType(TextInput).props.onChangeText('Old private draft'));
 act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Ask the community').props.onPress());
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'new', name: 'New' }, apiFetch } as never);
 await act(async () => screen.update(<FeedScreen />));
 await act(async () => finish({ ok: true, json: async () => ({ post: { id: 'old-question', body: 'Old private draft', author_id: 'old', created_at: '2026-10-11T00:00:00Z' }, outcome: 'none', reply: null }) }));
 expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
 expect(screen.root.findByType(FlatList).props.data).toHaveLength(0); act(() => screen.unmount());
});
