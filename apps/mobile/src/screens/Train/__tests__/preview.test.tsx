/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import TrainScreen from '../index';
import { useReducedMotion } from '@/hooks/useReducedMotion';
const { act, create } = require('react-test-renderer');
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: jest.fn() }));
jest.mock('@/state/Training', () => ({ useTraining: () => ({ workouts: [] }) }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: unknown) => require('react').createElement('Page', props), Action: 'Action' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: (props: unknown) => require('react').createElement('Preview', props) }));
jest.mock('@/components/Streak', () => ({ Streak: 'Streak' }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: (props: unknown) => require('react').createElement('Button', props) }));
jest.mock('expo-router', () => {
  const navigation = { addListener: () => () => {} };
  return { router: {}, useNavigation: () => navigation, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) };
});
let screen: ReturnType<typeof create>;
beforeEach(() => jest.mocked(useReducedMotion).mockReturnValue(false));
afterEach(() => { if (screen) act(() => screen.unmount()); });
test('Train loads on native engines without Intl.PluralRules', () => {
  const original = Intl.PluralRules;
  Object.defineProperty(Intl, 'PluralRules', { configurable: true, writable: true, value: undefined });
  try {
    jest.isolateModules(() => { expect(() => require('../index')).not.toThrow(); });
    act(() => { screen = create(<TrainScreen />); });
    const labels = JSON.stringify(screen.toJSON());
    for (const label of ['1st', '2nd', '3rd']) expect(labels).toContain(label);
  } finally {
    Object.defineProperty(Intl, 'PluralRules', { configurable: true, writable: true, value: original });
  }
});
test('first exercise autoplays and selecting it again keeps its focus and playback state', () => {
  act(() => { screen = create(<TrainScreen />); });
  const preview = () => screen.root.findByType('Preview').props;
  expect(preview()).toMatchObject({ selected: 'curl', playing: true });
  act(() => screen.root.findByProps({ testID: 'exercise-curl' }).props.onPress());
  expect(preview()).toMatchObject({ selected: 'curl', playing: true });
  act(() => screen.root.findByProps({ testID: 'glass-playback' }).props.onPress());
  act(() => screen.root.findByProps({ testID: 'exercise-curl' }).props.onPress());
  expect(preview()).toMatchObject({ selected: 'curl', playing: false });
  act(() => screen.root.findByProps({ testID: 'exercise-squat' }).props.onPress());
  expect(preview()).toMatchObject({ selected: 'squat', playing: true });
});
test('reduced motion keeps the first exercise focused without autoplay', () => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  act(() => { screen = create(<TrainScreen />); });
  expect(screen.root.findByType('Preview').props).toMatchObject({ selected: 'curl', playing: false });
});
test('autoplay starts after the motion preference finishes loading', () => {
  jest.mocked(useReducedMotion).mockReturnValue(null);
  act(() => { screen = create(<TrainScreen />); });
  expect(screen.root.findByType('Preview').props.playing).toBe(false);
  jest.mocked(useReducedMotion).mockReturnValue(false);
  act(() => screen.update(<TrainScreen />));
  expect(screen.root.findByType('Preview').props).toMatchObject({ selected: 'curl', playing: true });
});
