/* eslint-disable @typescript-eslint/no-require-imports -- Existing mobile renderer convention. */
import React from 'react';
import { Text, TextInput, Linking } from 'react-native';
import { FeedEditor } from '../FeedEditor';
import { examplePosts } from '../examples';
const { act, create } = require('react-test-renderer');
jest.mock('@/components/AppPage', () => ({ Action: 'Action', pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
const result = (outcome: string) => ({ post: { id: 'advice-one', kind: 'advice', body: 'How can I improve curls?', created_at: '2026-10-11T00:00:00Z', author_id: 'me' }, outcome, reply: outcome === 'none' ? null : { id: 'reply', body: outcome === 'fixed_pain' ? 'See a doctor or physio.' : 'Try a controlled descent.', created_at: '2026-10-11T00:00:00Z', ai_suggested: outcome === 'ai', sources: [{ id: 'source', kind: 'exercise', title: 'Curl guide', url: 'https://example.com/curl', post_id: null }] } });
for (const outcome of ['ai', 'fixed_pain', 'none']) it(`posts advice and opens a community thread for ${outcome}`, async () => {
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => result(outcome) });
 const onAdviceCreated = jest.fn(); let screen: any;
 await act(async () => { screen = create(<FeedEditor post={null} request={request} examples={false} advice onAdviceCreated={onAdviceCreated} onClose={jest.fn()} onCreated={jest.fn()} />); });
 expect(request).not.toHaveBeenCalled();
 act(() => screen.root.findByType(TextInput).props.onChangeText('  How can I improve curls?  '));
 await act(async () => screen.root.findByType('Action').props.onPress());
 expect(request.mock.calls[0][0]).toBe('/advice');
 expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ body: 'How can I improve curls?' });
 expect(onAdviceCreated.mock.calls[0][0].outcome).toBe(outcome);
 act(() => screen.unmount());
});
it('keeps an advice draft after failure, locks duplicate taps, and ignores a response after unmount', async () => {
 let resolve!: (r: any) => void;
 const request = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Try again later.' }) }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
 const onAdviceCreated = jest.fn(); let screen: any;
 await act(async () => { screen = create(<FeedEditor post={null} request={request} examples={false} advice onAdviceCreated={onAdviceCreated} onClose={jest.fn()} onCreated={jest.fn()} />); });
 act(() => screen.root.findByType(TextInput).props.onChangeText('How can I improve curls?'));
 await act(async () => screen.root.findByType('Action').props.onPress());
 expect(screen.root.findByType(TextInput).props.value).toBe('How can I improve curls?');
 act(() => { screen.root.findByType('Action').props.onPress(); screen.root.findByType('Action').props.onPress(); });
 expect(request).toHaveBeenCalledTimes(2);
 act(() => screen.unmount()); await act(async () => resolve({ ok: true, json: async () => result('ai') }));
 expect(onAdviceCreated).not.toHaveBeenCalled();
});
it('labels the system answer and opens safe source citations but never custom protocols', async () => {
 const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ ...result('ai').reply, author: null, sources: [...result('ai').reply!.sources, { id: 'unsafe', kind: 'exercise', title: 'Unsafe', url: 'javascript:alert(1)' }] }] });
 let screen: any;
 await act(async () => { screen = create(<FeedEditor post={{ ...examplePosts[0], kind: 'advice' }} request={request} examples={false} onClose={jest.fn()} onCreated={jest.fn()} />); });
 expect(screen.root.findAllByType(Text).some((n: any) => n.props.children === 'SteadyForum')).toBe(true);
 const links = screen.root.findAllByType('Button').filter((n: any) => n.props.accessibilityRole === 'link');
 expect(links).toHaveLength(1); await act(async () => links[0].props.onPress());
 expect(open).toHaveBeenCalledWith('https://example.com/curl');
 act(() => screen.unmount()); open.mockRestore();
});
it('never opens malformed citation URLs', async () => {
 const { sourceUrl } = require('../feedApi');
 expect(sourceUrl('https://example.com/article')).toBe('https://example.com/article');
 for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.com', 'not a URL', null]) expect(sourceUrl(url)).toBeNull();
});
it('rejects malformed advice responses and tells the user to check Feed before retrying', async () => {
 const { createAdvice } = require('../feedApi');
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...result('ai'), reply: null }) });
 await expect(createAdvice(request, 'Question')).rejects.toThrow('Refresh Feed before trying again');
});
it('discards malformed sources in the immediate advice reply', async () => {
 const { createAdvice } = require('../feedApi');
 const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...result('ai'), reply: { ...result('ai').reply, sources: [null, { id: 'bad', title: 7 }, result('ai').reply!.sources[0]] } }) });
 expect((await createAdvice(request, 'Question')).reply.sources).toHaveLength(1);
});
