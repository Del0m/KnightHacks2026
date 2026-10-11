import React from 'react';
import type { Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable } from 'react-native-worklets';
import { createPoseDetector } from 'spotter-pose';
import type { SocketLike } from '../cloud';
import { frameToCloudJpeg, scaledSize } from '../cloudFrame';
import { usePoseOutput, type PoseOutput } from '../usePoseOutput';

const { act, create } = require('react-test-renderer');

jest.mock('spotter-pose', () => ({ createPoseDetector: jest.fn(), createBasicPoseDetector: jest.fn() }));
jest.mock('react-native-vision-camera', () => ({ useFrameOutput: jest.fn(), HybridFrameConverter: {} }));
jest.mock('react-native-worklets', () => ({
  createSynchronizable: jest.fn(),
  scheduleOnRN: jest.fn((callback, ...args) => callback(...args)),
}));
jest.mock('../cloudFrame', () => ({ ...jest.requireActual('../cloudFrame'), frameToCloudJpeg: jest.fn() }));

const joints = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, c: 0.9 }));
const result = { source: 'cloud', model: 'yolov8n-pose-320', timestamp_ms: 1, score: 0.9, joints };

class FakeSocket implements SocketLike {
  binaryType?: string;
  readyState = 1;
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public token: string) {}
  send(d: ArrayBuffer) { this.sent.push(d); }
  close() { this.closed = true; }
  reply(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe('usePoseOutput, cloud engine', () => {
  let output: PoseOutput;
  let renderer: ReturnType<typeof create>;
  let onPose: jest.Mock;
  let sockets: FakeSocket[];
  let lastMs: number | null;
  const createSocket = (_url: string, token: string) => { const s = new FakeSocket(token); sockets.push(s); return s; };
  const getToken = jest.fn(async () => 'neon-jwt');
  const cloud = { url: 'wss://api.test/pose/stream', getToken, createSocket };

  function Harness() {
    output = usePoseOutput({ engine: 'cloud', onPose, cloud });
    return null;
  }
  function makeFrame(timestamp: number) { return { timestamp, dispose: jest.fn() }; }
  function processFrame(frame: ReturnType<typeof makeFrame>) {
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrame!(frame as unknown as Frame));
  }
  async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    onPose = jest.fn();
    sockets = [];
    lastMs = null;
    jest.mocked(createSynchronizable).mockReturnValue({
      getDirty: () => lastMs,
      setBlocking: (v: number) => { lastMs = v; },
    } as never);
    jest.mocked(useFrameOutput).mockReturnValue({} as never);
    jest.mocked(frameToCloudJpeg).mockImplementation(() => new Uint8Array([0xff, 0xd8, 1]).buffer);
    act(() => { renderer = create(React.createElement(Harness)); });
    await flush();
    act(() => sockets[0]!.reply({ type: 'ready' }));
  });
  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('runs no on-device detector and connects with the session token', () => {
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(sockets[0]!.token).toBe('neon-jwt');
    expect(output.cloudState).toBe('live');
    expect(output.model).toBe('cloud');
  });

  it('encodes each frame in the worklet, sends it with its timestamp, and disposes it', () => {
    jest.setSystemTime(new Date('2026-10-11T02:00:00.000Z'));
    const frame = makeFrame(1);
    processFrame(frame);
    expect(frameToCloudJpeg).toHaveBeenCalledWith(frame);
    expect(frame.dispose).toHaveBeenCalledTimes(1);
    const sent = sockets[0]!.sent[0]!;
    expect(new DataView(sent).getFloat64(0, false)).toBe(Date.parse('2026-10-11T02:00:00.000Z'));
    expect(Array.from(new Uint8Array(sent, 8))).toEqual([0xff, 0xd8, 1]);
  });

  it('caps cloud frames at 10 per second', () => {
    processFrame(makeFrame(1));
    const tooSoon = makeFrame(1.05);
    processFrame(tooSoon);
    expect(frameToCloudJpeg).toHaveBeenCalledTimes(1);
    expect(tooSoon.dispose).toHaveBeenCalledTimes(1);
  });

  it('delivers cloud results as PoseDetection and fills in model, fps and dropped', () => {
    processFrame(makeFrame(1));
    act(() => sockets[0]!.reply({ type: 'pose', timestamp_ms: 1, result, latency_ms: 95, endpoint_ms: 12, dropped: 3 }));
    expect(onPose).toHaveBeenCalledWith({ result: { ...result, source: 'cloud' }, latencyMs: 95 });
    act(() => jest.advanceTimersByTime(500));
    expect(output).toMatchObject({ model: 'yolov8n-pose-320', fps: 1, dropped: 3, error: null });
  });

  it('shows warming as reconnecting', () => {
    processFrame(makeFrame(1));
    act(() => sockets[0]!.reply({ type: 'status', status: 'warming' }));
    expect(output.cloudState).toBe('reconnecting');
  });

  it('reports an encoding failure and keeps going', () => {
    jest.mocked(frameToCloudJpeg).mockImplementationOnce(() => { throw new Error('encode failed'); });
    const frame = makeFrame(1);
    processFrame(frame);
    expect(frame.dispose).toHaveBeenCalledTimes(1);
    expect(output.error).toMatch(/encode failed/);
  });

  it('closes the socket on unmount', () => {
    act(() => renderer.unmount());
    expect(sockets[0]!.closed).toBe(true);
    act(() => { renderer = create(React.createElement(() => null)); });
  });
});

describe('cloud frame size', () => {
  it('fits 320 px on the long side and never upscales', () => {
    expect(scaledSize(1920, 1080)).toEqual({ width: 320, height: 180 });
    expect(scaledSize(1080, 1920)).toEqual({ width: 180, height: 320 });
    expect(scaledSize(200, 100)).toEqual({ width: 200, height: 100 });
  });
});
