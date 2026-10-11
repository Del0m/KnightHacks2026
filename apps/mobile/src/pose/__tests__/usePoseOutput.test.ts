import React from 'react';
import type { Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable } from 'react-native-worklets';
import { createPoseDetector } from 'steadyforum-pose';
import { usePoseOutput, type PoseOutput } from '../usePoseOutput';

const { act, create } = require('react-test-renderer');

jest.mock('steadyforum-pose', () => ({ createPoseDetector: jest.fn(), createBasicPoseDetector: jest.fn() }));
jest.mock('react-native-vision-camera', () => ({ useFrameOutput: jest.fn() }));
jest.mock('react-native-worklets', () => ({
  createSynchronizable: jest.fn(),
  scheduleOnRN: jest.fn((callback, ...args) => callback(...args)),
}));

describe('usePoseOutput frame lifecycle', () => {
  const detection = { result: undefined, latencyMs: 8 };
  let output: PoseOutput;
  let renderer: ReturnType<typeof create>;
  let onPose: jest.Mock;
  let detect: jest.Mock;
  let setFrameOutput: jest.Mock;
  let lastMs: number | null;
  let getDirty: jest.Mock;
  let setBlocking: jest.Mock;

  function Harness() {
    output = usePoseOutput({ onPose });
    return null;
  }

  function makeFrame(timestamp: number) {
    return { timestamp, dispose: jest.fn() };
  }

  function processFrame(frame: ReturnType<typeof makeFrame>) {
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrame!(frame as unknown as Frame));
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    onPose = jest.fn();
    detect = jest.fn(() => detection);
    setFrameOutput = jest.fn();
    lastMs = null;
    getDirty = jest.fn(() => lastMs);
    setBlocking = jest.fn((value: number) => { lastMs = value; });
    jest.mocked(createSynchronizable).mockReturnValue({ getDirty, setBlocking } as never);
    jest.mocked(createPoseDetector).mockReturnValue({ model: 'yolov8n-pose-320', detect, setFrameOutput } as never);
    jest.mocked(useFrameOutput).mockReturnValue({} as never);
    act(() => { renderer = create(React.createElement(Harness)); });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('delivers a no-person detection and disposes the frame exactly once', () => {
    const frame = makeFrame(1);
    processFrame(frame);
    expect(onPose).toHaveBeenCalledWith(detection);
    expect(frame.dispose).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(500));
    expect(output.fps).toBe(1);
  });

  it('binds the native frame output before inference so camera switches use the live connection', () => {
    const frame = makeFrame(1);
    processFrame(frame);
    expect(setFrameOutput).toHaveBeenCalledWith(output.frameOutput);
    expect(setFrameOutput.mock.invocationCallOrder[0]).toBeLessThan(detect.mock.invocationCallOrder[0]);
  });

  it('disposes skipped frames without inference', () => {
    processFrame(makeFrame(1));
    const skipped = makeFrame(1.01);
    processFrame(skipped);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(skipped.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['read', 'write', 'inference'])('disposes a frame after a %s error and processes the next one', (operation) => {
    const failure = new Error(`${operation} failed`);
    if (operation === 'read') getDirty.mockImplementationOnce(() => { throw failure; });
    if (operation === 'write') setBlocking.mockImplementationOnce(() => { throw failure; });
    if (operation === 'inference') detect.mockImplementationOnce(() => { throw failure; });
    const failed = makeFrame(1);
    processFrame(failed);
    expect(failed.dispose).toHaveBeenCalledTimes(1);
    expect(output.error).toContain(`${operation} failed`);
    processFrame(makeFrame(2));
    expect(onPose).toHaveBeenCalledTimes(1);
  });

  it('counts pipeline drops separately from throttle skips', () => {
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrameDropped!('out-of-buffers'));
    processFrame(makeFrame(1));
    processFrame(makeFrame(1.01));
    act(() => jest.advanceTimersByTime(500));
    expect(output.dropped).toBe(1);
    expect(output.fps).toBe(1);
  });
});
