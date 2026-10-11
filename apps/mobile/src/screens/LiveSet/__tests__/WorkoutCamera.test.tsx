/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { AppState } from 'react-native';
import WorkoutCamera from '../WorkoutCamera';
import { cameraSpec } from '../exercises';
import clip from '@/engine/__fixtures__/bicep_curl_clean.json';
import type { PoseDetection, PoseResult } from '@/pose/types';
const { act, create } = require('react-test-renderer');
let mockOnPose: (d: PoseDetection) => void;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('react-native-vision-camera', () => ({ Camera: 'Camera', useCameraDevice: (id: string) => ({ id, hasTorch: true }), useCameraPermission: () => ({ hasPermission: true }) }));
jest.mock('@/pose/usePoseMode', () => ({ startPoseBenchmark: () => Promise.resolve(), usePoseMode: () => ({ mode: 'coreml', size: 320 }) }));
jest.mock('@/pose/usePoseOutput', () => ({ usePoseOutput: ({ onPose }: { onPose: typeof mockOnPose }) => { mockOnPose = onPose; return { frameOutput: { currentResolution: { width: 1080, height: 1920 } }, error: null }; } }));
jest.mock('@/components/AppPage', () => ({ ui: {} }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('@/pose/PoseSkeleton', () => ({ PoseSkeleton: 'Skeleton' }));
it('counts fixture reps through the actual engine and saves measured feedback when Done is pressed', () => {
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  const complete = jest.fn();
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutCamera spec={cameraSpec('curl')} baseline={.7} onComplete={complete} onManual={jest.fn()} />); });
  expect(screen!.root.findByProps({ testID: 'live-rep-count' }).props.children).toBe(0);
  for (const result of clip.frames) act(() => mockOnPose({ result: result as PoseResult, latencyMs: 10 }));
  expect(screen!.root.findByProps({ testID: 'live-rep-count' }).props.children).toBe(8);
  act(() => screen!.root.findAllByType('Choice').find((n: any) => n.props.label === 'Done with set').props.onPress());
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0].reps).toHaveLength(8);
  expect(complete.mock.calls[0][1]).toMatchObject({ totalReps: 8, cleanReps: 1 });
  expect(complete.mock.calls[0][1].note).toContain('Around 2 s');
  act(() => screen!.unmount());
});
it.each(['manual', 'automatic'])('keeps the rear camera active for the %s completion pulse and hands off the set once', end => {
  jest.useFakeTimers(); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  const complete = jest.fn(), manual = jest.fn(), finishing = jest.fn(), recorded = jest.fn(); let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutCamera initialPosition="back" spec={cameraSpec('curl')} baseline={.7} onComplete={complete} onFinishing={finishing} onRecorded={recorded} onManual={manual} />); });
  for (const result of clip.frames) act(() => mockOnPose({ result: result as PoseResult, latencyMs: 10 }));
  if (end === 'manual') act(() => screen.root.findAllByType('Choice').find((n: any) => n.props.label === 'Done with set').props.onPress());
  else {
    act(() => mockOnPose({ latencyMs: 10 }));
    act(() => jest.advanceTimersByTime(3999));
    act(() => mockOnPose({ latencyMs: 10 }));
    expect(complete).not.toHaveBeenCalled();
    expect(screen.root.findByType('Camera').props.torchMode).toBe('off');
    act(() => jest.advanceTimersByTime(1));
    act(() => mockOnPose({ latencyMs: 10 }));
  }
  expect(finishing).toHaveBeenCalledTimes(1); expect(recorded).toHaveBeenCalledTimes(1);
  expect(recorded.mock.calls[0][0]).toMatchObject({ schema_version: 1, set_index: 0 });
  expect(recorded.mock.calls[0][0].frames.length).toBeGreaterThan(0);
  expect(recorded.mock.calls[0][2]).toBe('coreml');
  const fallback = screen.root.findAllByType('Choice').find((n: any) => n.props.label === 'Track manually');
  expect(fallback.props.disabled).toBe(true); act(() => fallback.props.onPress()); expect(manual).not.toHaveBeenCalled();
  expect(screen.root.findByType('Camera').props.torchMode).toBe('on');
  expect(screen.root.findByType('Camera').props.isActive).toBe(true); expect(complete).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(200));
  expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][0].reps).toHaveLength(8);
  expect(screen.root.findByType('Camera').props.torchMode).toBe('off');
  act(() => screen.unmount()); jest.useRealTimers();
});
