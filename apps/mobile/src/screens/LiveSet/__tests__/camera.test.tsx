/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import { AppState } from 'react-native';
import CameraCheck from '../CameraCheck';
import { usePoseOutput } from '@/pose/usePoseOutput';
import { useCameraPermission } from 'react-native-vision-camera';
import type { PoseResult } from '@/pose/types';
const { act, create } = require('react-test-renderer');
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: (props: unknown) => require('react').createElement('Choice', props) }));
jest.mock('@/pose/usePoseOutput', () => ({ usePoseOutput: jest.fn() }));
jest.mock('@/pose/usePoseMode', () => ({ usePoseMode: () => ({ mode: 'coreml', size: 320 }), startPoseBenchmark: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, []) }));
jest.mock('react-native-vision-camera', () => ({ Camera: (props: unknown) => require('react').createElement('Camera', props), useCameraDevice: () => ({ id: 'front' }), useCameraPermission: jest.fn() }));
let renderer: ReturnType<typeof create>;
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: true } as never);
  jest.mocked(usePoseOutput).mockReturnValue({ frameOutput: { currentResolution: { width: 1920, height: 1080 } }, error: null } as never);
});
afterEach(() => { act(() => renderer.unmount()); jest.useRealTimers(); });

test('camera check stabilizes detection, clears stale readiness, and respects mirroring', () => {
  const onContinue = jest.fn();
  act(() => { renderer = create(<CameraCheck exercise="squat" onContinue={onContinue} />); });
  act(() => renderer.root.findByProps({ testID: 'framing-preview' }).props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } }));
  act(() => renderer.root.findByType('Camera').props.onConfigured());
  expect(renderer.root.findByType('Camera').props.mirrorMode).toBe('off');
  const pose = (): PoseResult => ({ source: 'coreml', model: 'test', timestamp_ms: Date.now(), score: 0.9, joints: Array.from({ length: 17 }, (_, i) => ({ x: i % 2 ? 0.4 : 0.6, y: 0.2 + i / 30, c: 0.9 })) });
  const send = () => act(() => jest.mocked(usePoseOutput).mock.calls.at(-1)![0].onPose({ result: pose(), latencyMs: 10 }));
  send(); expect(onContinue).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(850)); send();
  expect(onContinue).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Side-on view');
  act(() => jest.advanceTimersByTime(1200));
  expect(JSON.stringify(renderer.toJSON())).toContain('Looking for you');
  send(); expect(onContinue).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1000)); send();
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test('denied camera access offers Settings instead of starting the detector', () => {
  jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: false, canRequestPermission: false } as never);
  act(() => { renderer = create(<CameraCheck exercise="curl" onContinue={jest.fn()} />); });
  expect(renderer.root.findAllByType('Camera')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Open camera settings');
});
