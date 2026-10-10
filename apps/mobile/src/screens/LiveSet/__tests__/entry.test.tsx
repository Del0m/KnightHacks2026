/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import CameraSetupScreen from '../index';
import WorkoutEntry from '@/app/workout';
import { router, useLocalSearchParams } from 'expo-router';
import { useTraining } from '@/state/Training';
const { act, create } = require('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: jest.fn(), Redirect: (props: unknown) => require('react').createElement('Redirect', props) }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: unknown) => require('react').createElement('Page', props), Action: 'Action' }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/services/workoutQueue', () => ({ queueWorkout: jest.fn(), syncWorkouts: jest.fn() }));
jest.mock('@/state/Training', () => ({ useTraining: jest.fn() }));
jest.mock('../WorkoutCamera', () => ({ __esModule: true, default: 'WorkoutCamera' }));
jest.mock('@/screens/Summary', () => ({ WorkoutSummary: 'WorkoutSummary' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: 'Body' }));
jest.mock('@/components/SetupPage', () => ({ SetupPage: (props: unknown) => require('react').createElement('SetupPage', props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('../CameraCheck', () => ({ __esModule: true, default: 'CameraCheck' }));
jest.mock('../PlacementDiagram', () => ({ PlacementDiagram: 'Diagram' }));
const finish = jest.fn(() => 'saved');
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useLocalSearchParams).mockReturnValue({}); jest.mocked(useTraining).mockReturnValue({ workouts: [], finish } as never); });
test('a direct workout entry starts camera setup first', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  expect(screen.root.findByType('Redirect').props.href).toBe('/camera-setup');
  act(() => screen.unmount());
});
test('camera setup starts a prepared workout and rechecks preserve an existing session', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<CameraSetupScreen />); });
  act(() => screen.root.findByType('SetupPage').props.onSecondary());
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/workout', params: { setup: 'done', mode: 'manual', exercise: 'bicep_curl' } });
  act(() => screen.unmount());
  jest.mocked(useLocalSearchParams).mockReturnValue({ returnTo: 'workout' });
  act(() => { screen = create(<CameraSetupScreen />); });
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('CameraCheck').props.onContinue());
  expect(router.back).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
test('leaving during rest saves completed camera sets and returns to Train', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('WorkoutCamera').props.onComplete({ exercise_id: 'bicep_curl', reps: [{ quality: null, flags: [], tempo_ms: 2000, range_deg: 100 }] }, null));
  act(() => screen.root.findByType('Page').props.headerAction.props.onPress());
  expect(finish).toHaveBeenCalledWith(1, 1, 1, [{ exercise_id: 'bicep_curl', reps: 1 }]);
  expect(router.replace).toHaveBeenCalledWith('/');
  act(() => screen.unmount());
});
test('leaving before the first set does not create an empty workout', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('Page').props.headerAction.props.onPress());
  expect(finish).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
  act(() => screen.unmount());
});
test.each([['curl', 'curl'], ['press', 'press']])('manual %s preview retains exercise selection', (exercise, selected) => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'manual', exercise });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  expect(screen.root.findByType('Body').props.selected).toBe(selected);
  act(() => screen.unmount());
});
