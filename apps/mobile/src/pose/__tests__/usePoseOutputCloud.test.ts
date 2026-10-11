import React from 'react';
import type { Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { createCloudFrameEncoder, createPoseDetector } from 'steadyforum-pose';
import { encodeFrame, type CloudFailure, type SocketLike } from '../cloud';
import { usePoseOutput, type CloudConfig, type PoseEngine, type PoseOutput } from '../usePoseOutput';

const { act, create } = require('react-test-renderer');

jest.mock('steadyforum-pose', () => ({
  createPoseDetector: jest.fn(),
  createBasicPoseDetector: jest.fn(),
  createCloudFrameEncoder: jest.fn(),
}));
jest.mock('react-native-vision-camera', () => ({ useFrameOutput: jest.fn() }));
jest.mock('react-native-worklets', () => ({ createSynchronizable: jest.fn(), scheduleOnRN: jest.fn() }));

const T0 = 1_800_000_000_000;
const joints = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, c: 0.9 }));
const result = { source: 'cloud', model: 'yolov8n-pose-320', timestamp_ms: T0, score: 0.9, joints };
const JPEG = new Uint8Array([0xff, 0xd8, 1]).buffer;

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
  stamps() { return this.sent.map((f) => new DataView(f).getFloat64(0, false)); }
}

describe('usePoseOutput, cloud engine', () => {
  let output: PoseOutput;
  let renderer: ReturnType<typeof create>;
  let onPose: jest.Mock;
  let sockets: FakeSocket[];
  let props: { engine: PoseEngine; cloud: CloudConfig | null };
  let encoder: { setFrameOutput: jest.Mock; encode: jest.Mock };
  let queue: (() => void)[] | null; // null: scheduleOnRN runs at once
  let failures: CloudFailure[];
  let available: boolean[];
  const frameOutput = { id: 'frame-output' };
  const getToken = jest.fn(async () => 'neon-jwt');
  const createSocket = (_url: string, token: string) => { const s = new FakeSocket(token); sockets.push(s); return s; };
  const config = (): CloudConfig => ({
    url: 'wss://api.test/pose/stream', getToken, createSocket,
    onFailure: (k) => failures.push(k), onAvailability: (a) => available.push(a),
  });

  function Harness() {
    output = usePoseOutput({ engine: props.engine, onPose, cloud: props.cloud });
    return null;
  }
  function rerender(p: Partial<typeof props>) {
    props = { ...props, ...p };
    act(() => renderer.update(React.createElement(Harness)));
  }
  function makeFrame(timestamp: number) { return { timestamp, dispose: jest.fn() }; }
  function processFrame(frame: ReturnType<typeof makeFrame>) {
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrame!(frame as unknown as Frame));
  }
  function drain() { act(() => { while (queue?.length) queue.shift()!(); }); }
  async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }
  const socket = () => sockets.at(-1)!;
  const stats = () => act(() => jest.advanceTimersByTime(500));

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    jest.clearAllMocks();
    onPose = jest.fn();
    sockets = []; failures = []; available = [];
    queue = null;
    jest.mocked(createSynchronizable).mockImplementation(((init: unknown) => {
      let v = init;
      return {
        getDirty: () => v,
        getBlocking: () => v,
        setBlocking: (x: unknown) => { v = typeof x === 'function' ? (x as (p: unknown) => unknown)(v) : x; },
      };
    }) as never);
    jest.mocked(scheduleOnRN).mockImplementation(((cb: (...a: unknown[]) => void, ...args: unknown[]) => {
      if (queue) queue.push(() => cb(...args)); else cb(...args);
    }) as never);
    encoder = {
      setFrameOutput: jest.fn(),
      encode: jest.fn(() => ({ jpeg: JPEG, timestampMs: Date.now(), width: 320, height: 180 })),
    };
    jest.mocked(createCloudFrameEncoder).mockReturnValue(encoder as never);
    jest.mocked(useFrameOutput).mockReturnValue(frameOutput as never);
    props = { engine: 'cloud', cloud: config() };
    act(() => { renderer = create(React.createElement(Harness)); });
    await flush();
    act(() => socket().reply({ type: 'ready' }));
  });
  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('runs no on-device detector, binds the encoder to the frame output and tracks once ready', () => {
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(encoder.setFrameOutput).toHaveBeenCalledWith(frameOutput);
    expect(socket().token).toBe('neon-jwt');
    expect(output.cloudStatus).toBe('tracking');
    expect(available).toEqual([true]);
    expect(output.model).toBe('cloud');
  });

  it('encodes in the worklet at no more than 10 fps and sends the exact packet', () => {
    const first = makeFrame(1);
    processFrame(first);
    const tooSoon = makeFrame(1.05);
    processFrame(tooSoon);
    expect(encoder.encode).toHaveBeenCalledTimes(1);
    expect(encoder.encode).toHaveBeenCalledWith(first);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(tooSoon.dispose).toHaveBeenCalledTimes(1);
    expect(Array.from(new Uint8Array(socket().sent[0]!))).toEqual(Array.from(new Uint8Array(encodeFrame(T0, JPEG))));
    processFrame(makeFrame(1.1));
    expect(encoder.encode).toHaveBeenCalledTimes(2);
  });

  it('holds at most 2 deliveries between the worklet and JS; beyond that frames are not encoded and count as dropped', () => {
    queue = [];
    const frames = [1, 1.1, 1.2, 1.3].map(makeFrame);
    frames.forEach(processFrame);
    expect(encoder.encode).toHaveBeenCalledTimes(2);
    expect(queue).toHaveLength(2);
    frames.forEach((f) => expect(f.dispose).toHaveBeenCalledTimes(1));
    drain();
    expect(socket().sent).toHaveLength(1);
    processFrame(makeFrame(1.4));
    expect(encoder.encode).toHaveBeenCalledTimes(3);
    stats();
    expect(output.dropped).toBe(2);
  });

  it('disposes a frame whose encoding failed, reports it and keeps going', () => {
    encoder.encode.mockImplementationOnce(() => { throw new Error('encode failed'); });
    const failed = makeFrame(1);
    processFrame(failed);
    expect(failed.dispose).toHaveBeenCalledTimes(1);
    expect(output.error).toMatch(/encode failed/);
    const next = makeFrame(1.1);
    processFrame(next);
    expect(next.dispose).toHaveBeenCalledTimes(1);
    expect(socket().sent).toHaveLength(1);
  });

  it('counts no-person detections in fps and passes the capture time', () => {
    processFrame(makeFrame(1));
    act(() => socket().reply({ type: 'pose', timestamp_ms: T0, result: null, latency_ms: 70, endpoint_ms: 9, dropped: 0 }));
    expect(onPose).toHaveBeenCalledWith({ result: undefined, latencyMs: 70, timestampMs: T0 });
    stats();
    expect(output.fps).toBe(1);
    expect(output.model).toBe('cloud');
  });

  it('reports the last result model', () => {
    processFrame(makeFrame(1));
    act(() => socket().reply({ type: 'pose', timestamp_ms: T0, result, latency_ms: 95, endpoint_ms: 12, dropped: 0 }));
    expect(onPose).toHaveBeenCalledWith({ result, latencyMs: 95, timestampMs: T0 });
    expect(output.model).toBe('yolov8n-pose-320');
  });

  it('counts camera drops, delivery-bound skips, replaced frames and relay drops, but not throttle skips', () => {
    queue = [];
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrameDropped!('out-of-buffers')); // camera: 1
    processFrame(makeFrame(1));
    processFrame(makeFrame(1.1));
    processFrame(makeFrame(1.2)); // bound skip: 1
    drain(); // first in flight, second pending
    processFrame(makeFrame(1.3));
    drain(); // replaces the pending frame: 1
    processFrame(makeFrame(1.35)); // throttled: not counted
    act(() => socket().reply({ type: 'pose', timestamp_ms: T0, result: null, latency_ms: 70, endpoint_ms: 9, dropped: 2 }));
    stats();
    expect(output.dropped).toBe(1 + 1 + 1 + 2);
  });

  it('surfaces warming as reconnecting and forwards failures', () => {
    processFrame(makeFrame(1));
    act(() => socket().reply({ type: 'status', status: 'warming' }));
    expect(output.cloudStatus).toBe('reconnecting');
    expect(failures).toEqual(['warming']);
    expect(available).toEqual([true, false]);
  });

  it('runs no transport without a config, and disposes frames without encoding', async () => {
    rerender({ cloud: null });
    expect(socket().closed).toBe(true);
    expect(output.cloudStatus).toBe('stopped');
    const frame = makeFrame(5);
    processFrame(frame);
    expect(encoder.encode).not.toHaveBeenCalled();
    expect(frame.dispose).toHaveBeenCalledTimes(1);
    await flush();
    expect(sockets).toHaveLength(1);

    rerender({ cloud: config() });
    expect(output.cloudStatus).toBe('connecting');
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('starts with a null config without opening a socket', async () => {
    act(() => renderer.unmount());
    sockets = [];
    getToken.mockClear();
    props = { engine: 'cloud', cloud: null };
    act(() => { renderer = create(React.createElement(Harness)); });
    await flush();
    expect(sockets).toHaveLength(0);
    expect(getToken).not.toHaveBeenCalled();
    expect(output.cloudStatus).toBe('stopped');
    expect(output.error).toBeNull();
  });

  it('closes the client when the config changes or on unmount', async () => {
    rerender({ cloud: config() });
    expect(sockets[0]!.closed).toBe(true);
    await flush();
    expect(sockets).toHaveLength(2);
    act(() => renderer.unmount());
    expect(sockets[1]!.closed).toBe(true);
    act(() => { renderer = create(React.createElement(() => null)); });
  });

  it('stops the transport when the engine leaves cloud', () => {
    jest.mocked(createPoseDetector).mockReturnValue({ model: 'yolov8n-pose-320', detect: jest.fn(), setFrameOutput: jest.fn() } as never);
    rerender({ engine: 'coreml' });
    expect(socket().closed).toBe(true);
    expect(output.cloudStatus).toBeNull();
  });
});
