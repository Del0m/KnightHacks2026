/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer test setup. */
import React from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../session';
import AuthScreen from '..';
const { act, create } = require('react-test-renderer');
jest.mock('../session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('@/components/AppPage', () => ({
  AppPage: ({ children }: { children: React.ReactNode }) => children,
  Action: ({ children, onPress, disabled }: { children: string; onPress: () => void; disabled?: boolean }) =>
    require('react').createElement(require('react-native').Text, { onPress, disabled, testID: 'action' }, children),
  ui: {},
}));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: ({ children }: { children: React.ReactNode }) => children }));

let renderer: ReturnType<typeof create>;
const base = { user: null, loading: false, error: null, configured: true, authenticate: jest.fn(), resendVerification: jest.fn(), refresh: jest.fn() };
const texts = () => renderer.root.findAllByType(Text).map((n: { props: { children: unknown } }) => n.props.children);
const googleButton = () => renderer.root.findAllByProps({ testID: 'action' }).find((n: { props: { children: unknown } }) => n.props.children === 'Continue with Google');
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useLocalSearchParams).mockReturnValue({}); });
afterEach(() => act(() => renderer.unmount()));

it('hides the Google button until Google sign-in is switched on', () => {
  jest.mocked(useAuth).mockReturnValue({ ...base, googleEnabled: false, signInWithGoogle: jest.fn() } as never);
  act(() => { renderer = create(<AuthScreen mode="login" />); });
  expect(googleButton()).toBeUndefined();
});

it('signs in with Google and opens the app', async () => {
  const signInWithGoogle = jest.fn(async () => true);
  jest.mocked(useAuth).mockReturnValue({ ...base, googleEnabled: true, signInWithGoogle } as never);
  act(() => { renderer = create(<AuthScreen mode="signup" />); });
  await act(async () => { googleButton().props.onPress(); });
  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
});

it('shows why when Google sends the user back with an error', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ error: 'access_denied' });
  jest.mocked(useAuth).mockReturnValue({ ...base, googleEnabled: true, signInWithGoogle: jest.fn() } as never);
  act(() => { renderer = create(<AuthScreen mode="login" />); });
  expect(texts()).toContain('Google sign-in didn’t finish. Please try again.');
});
