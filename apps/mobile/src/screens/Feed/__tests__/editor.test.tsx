/* eslint-disable @typescript-eslint/no-require-imports -- Existing mobile renderer convention. */
import React from 'react';
import { TextInput, Text } from 'react-native';
import { FeedEditor } from '../FeedEditor';
import { examplePosts } from '../examples';
const { act, create } = require('react-test-renderer');
jest.mock('@/components/AppPage', () => ({ Action: 'Action', pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
it('publishes a custom post only on explicit submit and prevents duplicate taps', async () => {
 let resolve!: (r: Response) => void;
 const request = jest.fn((_path: string, _options?: RequestInit) => new Promise<Response>(r => { resolve = r; }));
 const onClose = jest.fn(), onCreated = jest.fn();
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={null} request={request} examples={false} onClose={onClose} onCreated={onCreated} />); });
 expect(request).not.toHaveBeenCalled();
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.onChangeText('  A great leg day.  '));
 act(() => { const send = screen.root.findByType('Action').props.onPress; send(); send(); });
 expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0][0]).toBe('/posts');
 await act(async () => resolve({ ok: true, json: async () => ({ id: 'created' }) } as Response));
 expect(onCreated).toHaveBeenCalledWith('A great leg day.'); expect(onClose).toHaveBeenCalledTimes(1);
 act(() => screen.unmount());
});
it('loads existing comments and retains the draft after moderation rejection', async () => {
 const request = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => [] }).mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ message: 'Please keep it kind.' }) });
 const onCreated = jest.fn();
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={examplePosts[0]} request={request} examples={false} onClose={jest.fn()} onCreated={onCreated} />); });
 expect(request.mock.calls[0][0]).toBe(`/posts/${examplePosts[0].id}/comments`);
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.onChangeText('My comment'));
 await act(async () => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Post comment').props.onPress());
 expect(screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.value).toBe('My comment');
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'Please keep it kind.')).toBe(true);
 expect(onCreated).not.toHaveBeenCalled(); act(() => screen.unmount());
});
it('preview comments stay local', async () => {
 const request = jest.fn(), onCreated = jest.fn();
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={examplePosts[0]} request={request} examples onClose={jest.fn()} onCreated={onCreated} />); });
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.onChangeText('Nice set!'));
 await act(async () => screen.root.findByType('Action').props.onPress());
 expect(request).not.toHaveBeenCalled(); expect(onCreated).toHaveBeenCalledWith('Nice set!');
 expect(screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.value).toBe(''); act(() => screen.unmount());
});
it('a delayed comments response cannot erase a newly submitted comment', async () => {
 let finishRead!: (value: unknown) => void;
 const request = jest.fn().mockReturnValueOnce(new Promise(r => { finishRead = r; })).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'just-posted', created_at: '2026-10-11T00:00:00Z' }) });
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={examplePosts[0]} request={request} examples={false} onClose={jest.fn()} onCreated={jest.fn()} />); });
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.onChangeText('A new comment'));
 await act(async () => screen.root.findByType('Action').props.onPress());
 await act(async () => finishRead({ ok: true, json: async () => [] }));
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'A new comment')).toBe(true);
 act(() => screen.unmount());
});

it('limits new posts to 500 characters and presents a bottom sheet', async () => {
 const request = jest.fn(), onCreated = jest.fn();
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={null} request={request} examples onClose={jest.fn()} onCreated={onCreated} />); });
 const input = screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title');
 expect(input.props.maxLength).toBe(500);
 act(() => input.props.onChangeText('x'.repeat(501)));
 expect(screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.value).toHaveLength(500);
 expect(screen.root.findByProps({ testID: 'feed-editor-sheet' }).props.style.height).toBeGreaterThan(0);
 await act(async () => screen.root.findByType('Action').props.onPress());
 expect(onCreated).toHaveBeenCalledWith('x'.repeat(500));
 expect(request).not.toHaveBeenCalled(); act(() => screen.unmount());
});

it('does not duplicate a submitted comment already returned by the pending read', async () => {
 let finishRead!: (value: unknown) => void, finishWrite!: (value: unknown) => void;
 const result = { id: 'same-comment', created_at: '2026-10-11T00:00:00Z' };
 const request = jest.fn().mockReturnValueOnce(new Promise(r => { finishRead = r; })).mockReturnValueOnce(new Promise(r => { finishWrite = r; }));
 let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={examplePosts[0]} request={request} examples={false} onClose={jest.fn()} onCreated={jest.fn()} />); });
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel !== 'Post title').props.onChangeText('A new comment'));
 act(() => screen.root.findByType('Action').props.onPress());
 await act(async () => finishRead({ ok: true, json: async () => [{ ...result, body: 'A new comment', author: null }] }));
 await act(async () => finishWrite({ ok: true, json: async () => result }));
 expect(screen.root.findAllByType(Text).filter((n: any) => n.props.children === 'A new comment')).toHaveLength(1);
 act(() => screen.unmount());
});

it('submits an optional title separately from the body', async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'titled' }) });
 const onCreated = jest.fn(); let screen: ReturnType<typeof create>;
 await act(async () => { screen = create(<FeedEditor post={null} request={request} examples={false} onClose={jest.fn()} onCreated={onCreated} />); });
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === 'Post title').props.onChangeText('Leg day'));
 act(() => screen.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === 'Post text').props.onChangeText('Three solid sets'));
 await act(async () => screen.root.findByType('Action').props.onPress());
 expect(JSON.parse(request.mock.calls[0][1].body).title).toBe('Leg day');
 expect(onCreated).toHaveBeenCalledWith('Three solid sets', 'Leg day');
 act(() => screen.unmount());
});
