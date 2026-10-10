/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import OnboardingScreen from '../index';
import { OnboardingProvider } from '../state';
import { useAuth } from '@/screens/Auth/session';
const { act, create } = require('react-test-renderer');

jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/components/SetupPage', () => ({ SetupPage: (props: unknown) => require('react').createElement('SetupPage', props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: (props: unknown) => require('react').createElement('Choice', props) }));
let renderer: ReturnType<typeof create>;
beforeEach(() => jest.mocked(useAuth).mockReturnValue({ user: null, apiFetch: jest.fn() } as never));
afterEach(() => act(() => renderer.unmount()));
const choose = (label: string) => renderer.root.findAllByType('Choice').find((n: { props: { label: string } }) => n.props.label === label);
const next = () => act(() => renderer.root.findByType('SetupPage').props.onAction());

test('four-step onboarding enforces the goal limit and keeps choices when going back', async () => {
  act(() => { renderer = create(<OnboardingProvider><OnboardingScreen /></OnboardingProvider>); });
  act(() => { choose('Increase muscle').props.onPress(); });
  act(() => { choose('Build strength').props.onPress(); });
  act(() => { choose('Core').props.onPress(); });
  act(() => { choose('Back').props.onPress(); });
  expect(choose('Back').props.selected).toBe(false);
  await next();
  act(() => { choose('Experienced').props.onPress(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Your personal bests');
  act(() => { choose('Beginner').props.onPress(); });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Your personal bests');
  act(() => renderer.root.findByType('SetupPage').props.onBack());
  expect(choose('Core').props.selected).toBe(true);
  await next(); await next();
  expect(renderer.root.findByType('SetupPage').props.step).toBe(2);
  act(() => { choose('Every few days').props.onPress(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Every 3 days');
  await next();
  expect(renderer.root.findByType('SetupPage').props.secondary).toBe('Skip injury note');
  expect(JSON.stringify(renderer.toJSON())).toContain('Not medical advice');
});

test('guest completion cannot show a saved state', async () => {
  act(() => { renderer = create(<OnboardingProvider><OnboardingScreen /></OnboardingProvider>); });
  for (const label of ['Increase muscle', 'Core', 'Arms']) act(() => choose(label).props.onPress());
  await next(); act(() => choose('Beginner').props.onPress()); await next(); await next(); await next();
  expect(JSON.stringify(renderer.toJSON())).toContain('Log in to save your setup');
  expect(renderer.root.findByType('SetupPage').props.title).not.toContain('saved');
});

test('account changes discard the previous account’s answers', async () => {
  const apiFetch = jest.fn().mockResolvedValue(new Response('', { status: 404 }));
  jest.mocked(useAuth).mockReturnValue({ user: { id: 'a' }, apiFetch } as never);
  await act(async () => { renderer = create(<OnboardingProvider key="a"><OnboardingScreen /></OnboardingProvider>); });
  act(() => choose('Increase muscle').props.onPress());
  jest.mocked(useAuth).mockReturnValue({ user: { id: 'b' }, apiFetch } as never);
  await act(async () => renderer.update(<OnboardingProvider key="b"><OnboardingScreen /></OnboardingProvider>));
  expect(choose('Increase muscle').props.selected).toBe(false);
});
