import React from 'react';
import type { Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable } from 'react-native-worklets';
import { createBasicPoseDetector, createPoseDetector } from 'spotter-pose';
import { BASIC_MODEL, isBasicModeSupported, useBasicPoseOutput } from '../basic';
import { usePoseOutput, type PoseEngine, type PoseOutput } from '../usePoseOutput';

const { act, create } = require('react-test-renderer');

jest.mock('spotter-pose', () => ({ createPoseDetector: jest.fn(), createBasicPoseDetector: jest.fn() }));
jest.mock('react-native-vision-camera', () => ({ useFrameOutput: jest.fn() }));
jest.mock('react-native-worklets', () => ({
  createSynchronizable: jest.fn(),
  scheduleOnRN: jest.fn((callback, ...args) => callback(...args)),
}));

const visionDetection = {
  latencyMs: 12,
  result: {
    source: 'vision',
    model: 'apple-vision-body-pose',
    timestamp_ms: 1,
    score: 0.8,
    joints: Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, c: 0.8 })),
  },
};

describe('basic mode (Apple Vision)', () => {
  let output: PoseOutput;
  let renderer: ReturnType<typeof create>;
  let onPose: jest.Mock;
  let yolo: { model: string; detect: jest.Mock; setFrameOutput: jest.Mock };
  let vision: { model: string; detect: jest.Mock; setFrameOutput: jest.Mock };
  let lastMs: number | null;

  function processFrame(timestamp: number) {
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrame!({ timestamp, dispose: jest.fn() } as unknown as Frame));
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    onPose = jest.fn();
    lastMs = null;
    yolo = { model: 'yolov8n-pose-320', detect: jest.fn(() => ({ latencyMs: 8 })), setFrameOutput: jest.fn() };
    vision = { model: 'apple-vision-body-pose', detect: jest.fn(() => visionDetection), setFrameOutput: jest.fn() };
    jest.mocked(createSynchronizable).mockReturnValue({
      getDirty: () => lastMs,
      setBlocking: (v: number) => { lastMs = v; },
    } as never);
    jest.mocked(createPoseDetector).mockReturnValue(yolo as never);
    jest.mocked(createBasicPoseDetector).mockReturnValue(vision as never);
    jest.mocked(useFrameOutput).mockReturnValue({} as never);
  });

  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('useBasicPoseOutput runs Apple Vision, never YOLOv8', () => {
    function Harness() {
      output = useBasicPoseOutput({ onPose });
      return null;
    }
    act(() => { renderer = create(React.createElement(Harness)); });
    processFrame(1);

    expect(createBasicPoseDetector).toHaveBeenCalledTimes(1);
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(vision.setFrameOutput).toHaveBeenCalledWith(output.frameOutput);
    expect(onPose).toHaveBeenCalledWith(visionDetection);
    expect(output.model).toBe(BASIC_MODEL);
  });

  it('switches YOLOv8 to Vision and back on a live hook, rebinding the camera output', () => {
    function Harness({ engine }: { engine: PoseEngine }) {
      output = usePoseOutput({ engine, onPose });
      return null;
    }
    act(() => { renderer = create(React.createElement(Harness, { engine: 'coreml' })); });
    processFrame(1);
    expect(yolo.detect).toHaveBeenCalledTimes(1);
    expect(output.model).toBe('yolov8n-pose-320');

    act(() => renderer.update(React.createElement(Harness, { engine: 'vision' })));
    processFrame(2);
    expect(vision.setFrameOutput).toHaveBeenCalledWith(output.frameOutput);
    expect(vision.detect).toHaveBeenCalledTimes(1);
    expect(yolo.detect).toHaveBeenCalledTimes(1);
    expect(output.model).toBe(BASIC_MODEL);

    act(() => renderer.update(React.createElement(Harness, { engine: 'coreml' })));
    processFrame(3);
    expect(yolo.detect).toHaveBeenCalledTimes(2);
    expect(output.model).toBe('yolov8n-pose-320');
  });

  it('reports a Vision creation error without crashing', () => {
    jest.mocked(createBasicPoseDetector).mockImplementation(() => { throw new Error('no Vision'); });
    function Harness() {
      output = useBasicPoseOutput({ onPose });
      return null;
    }
    act(() => { renderer = create(React.createElement(Harness)); });
    expect(output.model).toBeNull();
    expect(output.error).toContain('no Vision');
  });
});

describe('isBasicModeSupported', () => {
  it('is iPhone-only', () => {
    expect(isBasicModeSupported('ios')).toBe(true);
    expect(isBasicModeSupported('android')).toBe(false);
    expect(isBasicModeSupported('web')).toBe(false);
  });
});
