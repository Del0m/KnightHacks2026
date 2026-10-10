/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import SettingsScreen from '../index';
import { router } from 'expo-router';
import { useOnboarding } from '@/screens/Onboarding/state';
const { act, create } = require('react-test-renderer');
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('@/screens/Onboarding/state', () => ({ useOnboarding: jest.fn() }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: unknown) => require('react').createElement('Page', props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: (props: unknown) => require('react').createElement('Choice', props) }));
test('settings opens every onboarding question at its own step', () => {
  const setStep = jest.fn();
  jest.mocked(useOnboarding).mockReturnValue({ setStep } as never);
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<SettingsScreen />); });
  for (const [step, label] of ['Goals', 'Experience & personal bests', 'Workout schedule', 'Injuries & limitations'].entries()) {
    act(() => screen.root.findByProps({ label }).props.onPress());
    expect(setStep).toHaveBeenLastCalledWith(step);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/onboarding', params: { from: 'settings' } });
  }
  act(() => screen.unmount());
});
