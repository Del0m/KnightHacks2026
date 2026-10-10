/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import CameraSetupScreen from '../index';
import WorkoutEntry from '@/app/workout';
import { router, useLocalSearchParams } from 'expo-router';
const { act, create } = require('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: jest.fn(), Redirect: (props: unknown) => require('react').createElement('Redirect', props) }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: unknown) => require('react').createElement('Page', props), Action: 'Action' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: 'Body' }));
jest.mock('@/components/SetupPage', () => ({ SetupPage: (props: unknown) => require('react').createElement('SetupPage', props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('../CameraCheck', () => ({ __esModule: true, default: 'CameraCheck' }));
jest.mock('../PlacementDiagram', () => ({ PlacementDiagram: 'Diagram' }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useLocalSearchParams).mockReturnValue({}); });
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
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/workout', params: { setup: 'done' } });
  act(() => screen.unmount());
  jest.mocked(useLocalSearchParams).mockReturnValue({ returnTo: 'workout' });
  act(() => { screen = create(<CameraSetupScreen />); });
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('CameraCheck').props.onContinue());
  expect(router.back).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
