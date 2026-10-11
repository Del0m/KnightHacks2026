/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import PracticeScreen from '@/app/practice';
const { act, create } = require('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: jest.fn(() => ({ exercise: 'push_up' })) }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: object) => require('react').createElement('Page', props), Action: 'Action' }));
jest.mock('@/screens/LiveSet/WorkoutCamera', () => ({ __esModule: true, default: 'Camera' }));
const mockFinish = jest.fn();
jest.mock('@/state/Training', () => ({ useTraining: () => ({ finish: mockFinish }) }));
test('practice provides advice, retries with a fresh camera and returns without saving workout history', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ exercise: 'push_up' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<PracticeScreen />); });
  const camera = screen.root.findByType('Camera');
  expect(camera.props.spec.id).toBe('push_up');
  act(() => camera.props.onComplete({ exercise_id: 'push_up', reps: [] }, { medal: 'silver', cleanReps: 4, totalReps: 5, note: '4 good reps / 5 total. Keep your hips level.' }));
  expect(screen.root.findAllByType('Camera')).toHaveLength(0);
  expect(screen.root.findAllByType(Text).some((text: { props: { children: string } }) => text.props.children.includes('Keep your hips level.'))).toBe(true);
  act(() => screen.root.findAllByType('Action').find((button: { props: { children: string } }) => button.props.children === 'Practice again').props.onPress());
  expect(screen.root.findByType('Camera')).not.toBe(camera);
  expect(mockFinish).not.toHaveBeenCalled();
  act(() => screen.root.findByType('Page').props.headerAction.props.onPress());
  expect(router.replace).toHaveBeenCalledWith('/');
  act(() => screen.unmount());
});
