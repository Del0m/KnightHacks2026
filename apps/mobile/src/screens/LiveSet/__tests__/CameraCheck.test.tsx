/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React from 'react';
import { AppState } from 'react-native';
import CameraCheck from '../CameraCheck';
import type { PoseDetection } from '@/pose/types';
const { act, create } = require('react-test-renderer');
let mockOnPose: (d: PoseDetection) => void;
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('react-native-vision-camera', () => ({ Camera: 'Camera', useCameraDevice: (id: string) => ({ id, hasTorch: true }), useCameraPermission: () => ({ hasPermission: true }) }));
jest.mock('@/pose/usePoseMode', () => ({ startPoseBenchmark: () => Promise.resolve(), usePoseMode: () => ({ mode: 'coreml', size: 320 }) }));
jest.mock('@/pose/usePoseOutput', () => ({ usePoseOutput: ({ onPose }: { onPose: typeof mockOnPose }) => { mockOnPose = onPose; return { frameOutput: { currentResolution: { width: 1080, height: 1920 } }, error: null }; } }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => ({ user: { id: 'user-1' }, getApiToken: async () => null }) }));
jest.mock('@/screens/Auth/client', () => ({ apiUrl: 'https://api.test' }));
jest.mock('../FramingGuide', () => ({ FramingGuide: 'Guide' }));
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(10000); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true }); });
afterEach(() => jest.useRealTimers());
test.each(['front', 'back'] as const)('confirms %s framing once without a button; rear light pulses before advancing', position => {
 const done = jest.fn(); let screen: ReturnType<typeof create>;
 act(() => { screen = create(<CameraCheck exercise="squat" onContinue={done} />); });
 if (position === 'back') act(() => screen.root.findAllByType('Choice').find((n: any) => n.props.label === 'Use back camera').props.onPress());
 act(() => screen.root.findByProps({ testID: 'framing-preview' }).props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } }));
 act(() => screen.root.findByType('Camera').props.onConfigured());
 const frame = () => act(() => mockOnPose({ latencyMs: 10, result: { source: 'coreml', model: 'test', timestamp_ms: Date.now(), score: .9, joints: Array.from({ length: 17 }, (_, i) => ({ x: i % 2 ? .4 : .6, y: .2 + i / 30, c: .9 })) } }));
 // A missing pose interrupts the continuous hold; returning must restart the second.
 frame(); act(() => jest.advanceTimersByTime(500));
 act(() => mockOnPose({ latencyMs: 10 }));
 act(() => jest.advanceTimersByTime(500));
 frame(); act(() => jest.advanceTimersByTime(999)); frame(); expect(done).not.toHaveBeenCalled();
 act(() => jest.advanceTimersByTime(1)); frame();
 if (position === 'back') {
  expect(screen.root.findByType('Camera').props.torchMode).toBe('on'); expect(done).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(200));
 }
 expect(done).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledWith('camera', position);
 expect(screen.root.findByType('Camera').props.torchMode).toBe('off'); frame(); expect(done).toHaveBeenCalledTimes(1);
 expect(screen.root.findAllByType('Choice').some((n: any) => n.props.label === 'Framing checked · continue')).toBe(false);
 act(() => screen.unmount());
});
