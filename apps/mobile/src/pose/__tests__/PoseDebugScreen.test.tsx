import React from 'react';
import { Text, View } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { PoseDebugScreen } from '../PoseDebugScreen';
import { usePoseOutput } from '../usePoseOutput';
import { benchmarkPoseModel } from 'steadyforum-pose';
import { __clearPoseStoreForTests } from '../modeStore';
import { __resetPoseModeForTests, startPoseBenchmark } from '../usePoseMode';

const { act, create } = require('react-test-renderer');

jest.mock('../usePoseOutput', () => ({ usePoseOutput: jest.fn() }));
jest.mock('steadyforum-pose', () => ({ benchmarkPoseModel: jest.fn(), getPoseModelId: jest.fn(() => 'model-a') }));
jest.mock('../PoseSkeleton', () => ({
  PoseSkeleton: (props: unknown) => require('react').createElement('PoseSkeleton', props),
}));
jest.mock('react-native-vision-camera', () => ({
  Camera: (props: unknown) => require('react').createElement('Camera', props),
  useCameraDevice: jest.fn((position) => ({ position })),
  useCameraPermission: jest.fn(),
}));

describe('PoseDebugScreen', () => {
  let renderer: ReturnType<typeof create>;
  let frameOutput: { currentResolution: { width: number; height: number } };

  beforeEach(() => {
    jest.clearAllMocks();
    __clearPoseStoreForTests();
    __resetPoseModeForTests();
    frameOutput = { currentResolution: { width: 1920, height: 1080 } };
    jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: true, canRequestPermission: false } as never);
    jest.mocked(usePoseOutput).mockReturnValue({ frameOutput, fps: 15, error: null, model: 'yolov8n-pose-320', dropped: 0 } as never);
  });

  afterEach(() => act(() => renderer.unmount()));

  it('refreshes upright overlay dimensions after switching cameras', () => {
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({
      nativeEvent: { layout: { width: 390, height: 844 } },
    }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 1080, height: 1920 });
    expect(renderer.root.findByType('PoseSkeleton').props.mirrored).toBe(true);
    expect(renderer.root.findByType('Camera').props.mirrorMode).toBe('off');
    expect(renderer.root.findByType('Camera').props.orientationSource).toBe('interface');

    const button = renderer.root.findAll((node: { props: { onPress?: unknown } }) =>
      typeof node.props.onPress === 'function')[0];
    act(() => button.props.onPress());
    expect(renderer.root.findAllByType('PoseSkeleton')).toHaveLength(0);
    frameOutput.currentResolution = { width: 1280, height: 720 };
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 720, height: 1280 });
    expect(renderer.root.findByType('PoseSkeleton').props.mirrored).toBe(false);
  });

  it('shows the skeleton on startup when the resolution is unknown at configure time', () => {
    frameOutput.currentResolution = undefined as never;
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({
      nativeEvent: { layout: { width: 390, height: 844 } },
    }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findAllByType('PoseSkeleton')).toHaveLength(0);

    // Frames are flowing by the first pose, so the resolution is known.
    frameOutput.currentResolution = { width: 1920, height: 1080 };
    const { onPose } = jest.mocked(usePoseOutput).mock.calls.at(-1)![0];
    act(() => onPose({ latencyMs: 8 }));
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 1080, height: 1920 });
  });

  it('toggles between YOLOv8 and Apple Vision', () => {
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('coreml');

    const toggle = () => renderer.root.findByProps({ testID: 'pose-engine-toggle' });
    expect(JSON.stringify(renderer.toJSON())).toContain('Use Apple Vision');
    act(() => toggle().props.onPress());
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('vision');
    expect(JSON.stringify(renderer.toJSON())).toContain('Use Core ML');

    act(() => toggle().props.onPress());
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('coreml');
  });

  it('re-runs the benchmark with the camera unmounted, then uses the size that passed', async () => {
    let finish!: (v: unknown) => void;
    jest.mocked(benchmarkPoseModel).mockReturnValueOnce(new Promise((r) => { finish = r; }) as never);
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(renderer.root.findAllByType('Camera')).toHaveLength(1);

    act(() => renderer.root.findByProps({ testID: 'pose-rerun-benchmark' }).props.onPress());
    expect(renderer.root.findAllByType('Camera')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Benchmarking');

    await act(async () => {
      finish({ size: 320, model: 'yolov8n-pose-320', meanMs: 9, p95Ms: 10, samples: 150 });
    });
    expect(renderer.root.findAllByType('Camera')).toHaveLength(1);
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].size).toBe(320);
    expect(JSON.stringify(renderer.toJSON())).toContain('"mode ","coreml"');
  });

  it('toggles cloud consent', async () => {
    jest.mocked(benchmarkPoseModel).mockRejectedValue(new Error('model missing'));
    await act(() => startPoseBenchmark('ios'));
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    const text = () => renderer.root.findAllByType(Text)
      .map((t: { props: { children: unknown } }) => [t.props.children].flat().join('')).join('\n');
    expect(text()).toContain('consent needed');
    act(() => renderer.root.findByProps({ testID: 'pose-consent-toggle' }).props.onPress());
    expect(text()).toContain('consent yes');
    expect(text()).toContain('Revoke cloud consent');
  });

  it('shows a rejected permission request instead of an unhandled rejection', async () => {
    jest.mocked(useCameraPermission).mockReturnValue({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: jest.fn().mockRejectedValue(new Error('permission request failed')),
    } as never);
    await act(async () => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(JSON.stringify(renderer.toJSON())).toContain('permission request failed');
  });
});
