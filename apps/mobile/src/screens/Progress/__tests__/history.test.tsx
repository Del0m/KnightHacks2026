/* eslint-disable @typescript-eslint/no-require-imports -- Matches existing renderer tests. */
import React from 'react';
import { Text } from 'react-native';
import { WorkoutCalendar } from '../index';
import { useTraining } from '@/state/Training';
const { act, create } = require('react-test-renderer');
jest.mock('@/state/Training', () => ({ useTraining: jest.fn() }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('@/screens/Onboarding/state', () => ({ useOnboarding: jest.fn() }));
jest.mock('../SyncedProgress', () => ({ SyncedProgress: () => null }));
jest.mock('@/components/AppPage', () => ({ AppPage: ({ children }: { children: React.ReactNode }) => children, Action: () => null, pageStyles: () => ({}) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: () => null }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: (props: object) => require('react').createElement(require('react-native').Pressable, props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: ({ label, onPress }: { label: string; onPress: () => void }) => require('react').createElement(require('react-native').Pressable, { accessibilityLabel: label, onPress }) }));
it('opens every workout on a completed day, distinguishes measured form from legacy totals, and closes', () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 9, 10, 12));
  const base = { day: '2026-10-10', minutes: 3, sets: 1, reps: 8 };
  jest.mocked(useTraining).mockReturnValue({ workouts: [
    { ...base, id: 'legacy', finishedAt: '2026-10-10T12:00:00Z' },
    { ...base, id: 'camera', finishedAt: '2026-10-10T13:00:00Z', details: [{ exercise_id: 'bicep_curl', reps: 8, goodReps: 6, medal: 'silver', note: 'Keep your upper arms steady.' }] },
    { ...base, day: '2026-10-09', id: 'manual', finishedAt: '2026-10-09T13:00:00Z', details: [{ exercise_id: 'squat', reps: 8 }] },
  ] } as never);
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutCalendar />); });
  const text = () => screen.root.findAllByType(Text).map((node: { props: { children: unknown } }) => JSON.stringify(node.props.children)).join(' ');
  act(() => screen.root.findAll((node: { props: { accessibilityLabel?: string } }) => node.props.accessibilityLabel?.startsWith('2026-10-10'))[0].props.onPress());
  expect(text()).toContain('2');
  expect(text()).toContain('6 with good form');
  expect(text()).toContain('silver medal');
  expect(text()).toContain('totals only');
  expect(text()).toContain('Keep your upper arms steady.');
  act(() => screen.root.findAll((node: { props: { accessibilityLabel?: string } }) => node.props.accessibilityLabel?.startsWith('2026-10-09'))[0].props.onPress());
  expect(text()).toContain('Form not measured');
  expect(text()).not.toContain('totals only');
  act(() => screen.root.findByProps({ accessibilityLabel: 'Close' }).props.onPress());
  expect(text()).not.toContain('Form not measured');
  act(() => screen.unmount()); jest.useRealTimers();
});
