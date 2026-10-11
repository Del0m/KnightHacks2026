import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createBasicPoseDetector, createCloudFrameEncoder, createPoseDetector } from 'steadyforum-pose';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { CloudPoseClient, type CloudFailure, type CloudStatus, type CreateSocket } from './cloud';
import { shouldProcess } from './throttle';
import type { PoseDetection } from './types';

const FPS_WINDOW_MS = 1000;

/**
 * `coreml` runs YOLOv8n-pose; `vision` runs Apple Vision body pose (basic mode, see `basic.ts`);
 * `cloud` streams frames to the API's /pose/stream relay (CONN-11, see `cloud.ts`).
 */
export type PoseEngine = 'coreml' | 'vision' | 'cloud';

/** Cloud mode sends ~10 fps (the relay's endpoint answers one frame at a time). */
const CLOUD_MAX_FPS = 10;
/** Encoded frames on their way from the worklet to the socket; past this a frame is dropped unencoded. */
const MAX_CLOUD_DELIVERIES = 2;

export interface CloudConfig {
  /** The relay's WebSocket URL, from `poseStreamUrl(apiUrl)`. */
  url: string;
  /** A fresh Neon Auth token for each connection (`authClient.token()`). Never the HF token. */
  getToken: () => Promise<string | null>;
  createSocket?: CreateSocket; // tests
  /** The relay is ready (true), or failed or dropped (false). */
  onAvailability?: (available: boolean) => void;
  onFailure?: (kind: CloudFailure) => void;
}
const STATS_INTERVAL_MS = 500;

export interface PoseOutput {
  /** Pass to `<Camera outputs={[frameOutput]} mirrorMode="off" />`. */
  frameOutput: CameraFrameOutput;
  /** Processed results in the last second. */
  fps: number;
  /** Detector creation error, or the last per-frame error. The stream keeps running either way. */
  error: string | null;
  /** Model name, e.g. `yolov8n-pose-320` or `apple-vision-body-pose`; null when the detector could not be created. */
  model: string | null;
  /**
   * Frames dropped since mount: by the camera pipeline (`onFrameDropped`) and, in cloud mode, frames
   * skipped on the way to JS, replaced while waiting, or skipped by the relay. Throttling isn't counted.
   */
  dropped: number;
  /** Cloud mode only: 'reconnecting' while the endpoint warms up or after a failure; 'stopped' without a config. */
  cloudStatus: CloudStatus | null;
}

/**
 * Runs the native pose detector on camera frames, at most `maxFps` times a second.
 * Frames over the limit are disposed straight away (never queued); a frame that throws
 * is reported in `error` and the stream carries on.
 *
 * The Camera must use `mirrorMode="off"` so the frame buffer is not mirrored and
 * joints keep anatomical left/right. Mirroring happens only when drawing.
 */
export function usePoseOutput(opts: {
  engine?: PoseEngine;
  /** YOLOv8 input size; ignored by the `vision` engine. */
  size?: 320 | 256;
  maxFps?: number;
  onPose: (d: PoseDetection) => void;
  /** `engine: 'cloud'` streams only while this is set; null stops the transport. A new object reconnects. */
  cloud?: CloudConfig | null;
}): PoseOutput {
  const { engine = 'coreml', size = 320, onPose, cloud } = opts;
  const isCloud = engine === 'cloud';
  const maxFps = isCloud ? Math.min(opts.maxFps ?? CLOUD_MAX_FPS, CLOUD_MAX_FPS) : opts.maxFps ?? 15;

  const created = useMemo(() => {
    if (engine === 'cloud') return { detector: null, createError: null };
    try {
      const detector = engine === 'vision' ? createBasicPoseDetector() : createPoseDetector(size);
      return { detector, createError: null };
    } catch (e) {
      return { detector: null, createError: String(e) };
    }
  }, [engine, size]);
  const { detector, createError } = created;

  const cloudEncoder = useMemo(() => {
    if (!isCloud) return { encoder: null, encoderError: null };
    try {
      return { encoder: createCloudFrameEncoder(), encoderError: null };
    } catch (e) {
      return { encoder: null, encoderError: String(e) };
    }
  }, [isCloud]);
  const { encoder, encoderError } = cloudEncoder;

  const [frameError, setFrameError] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('stopped');
  const [cloudModel, setCloudModel] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [dropped, setDropped] = useState(0);

  // Last processed frame time (ms), shared with the frame thread. Null until the first frame.
  const lastMs = useMemo(() => createSynchronizable<number | null>(null), []);
  // Cloud frames scheduled from the worklet but not yet handed to the client, and frames skipped for it.
  const deliveries = useMemo(() => createSynchronizable(0), []);
  const deliverySkips = useMemo(() => createSynchronizable(0), []);

  const onPoseRef = useRef(onPose);
  useLayoutEffect(() => { onPoseRef.current = onPose; }, [onPose]);
  const processedAt = useRef<number[]>([]);
  const droppedCount = useRef(0);
  const failedCount = useRef(0);

  const handleDetection = useCallback((d: PoseDetection) => {
    processedAt.current.push(Date.now());
    onPoseRef.current(d);
  }, []);

  // Cloud mode: one client per config; frames from the worklet go to it on the JS thread.
  const cloudClient = useRef<CloudPoseClient | null>(null);
  const cloudConfig = isCloud ? cloud ?? null : null;
  const cloudActive = cloudConfig != null && encoder != null;
  useEffect(() => {
    if (!cloudConfig) return;
    const client = new CloudPoseClient({
      url: cloudConfig.url,
      getToken: cloudConfig.getToken,
      createSocket: cloudConfig.createSocket,
      onPose: (d, drops) => {
        droppedCount.current += drops.replaced + drops.relay;
        if (d.result) setCloudModel((m) => (m === d.result!.model ? m : d.result!.model));
        handleDetection(d);
      },
      onStatus: setCloudStatus,
      onAvailability: cloudConfig.onAvailability,
      onFailure: cloudConfig.onFailure,
    });
    cloudClient.current = client;
    client.start();
    return () => {
      client.close();
      if (cloudClient.current === client) cloudClient.current = null;
    };
  }, [cloudConfig, handleDetection]);

  const sendCloudFrame = useCallback((timestampMs: number, jpeg: ArrayBuffer) => {
    deliveries.setBlocking((n) => n - 1);
    cloudClient.current?.send(timestampMs, jpeg);
  }, [deliveries]);

  const handleFrameError = useCallback((message: string) => {
    failedCount.current += 1;
    setFrameError(`${failedCount.current} frame(s) failed; last: ${message}`);
  }, []);

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        const nowMs = frame.timestamp * 1000;
        if (isCloud) {
          if (!cloudActive || encoder == null || !shouldProcess(nowMs, lastMs.getDirty(), maxFps)) return;
          lastMs.setBlocking(nowMs);
          // JS hasn't taken the last frames yet: drop this one rather than queue it.
          if (deliveries.getDirty() >= MAX_CLOUD_DELIVERIES) {
            deliverySkips.setBlocking((n) => n + 1);
            return;
          }
          // Encoded natively, off the JS thread; only the JPEG bytes cross to the socket.
          const encoded = encoder.encode(frame);
          deliveries.setBlocking((n) => n + 1);
          scheduleOnRN(sendCloudFrame, encoded.timestampMs, encoded.jpeg);
          return;
        }
        if (detector == null || !shouldProcess(nowMs, lastMs.getDirty(), maxFps)) return;
        lastMs.setBlocking(nowMs);
        // Native sets source "coreml" or "vision"; the Nitro spec types it as string.
        const d = detector.detect(frame) as PoseDetection;
        scheduleOnRN(handleDetection, d);
      } catch (e) {
        scheduleOnRN(handleFrameError, String(e));
      } finally {
        frame.dispose();
      }
    },
    [detector, isCloud, cloudActive, encoder, maxFps, lastMs, deliveries, deliverySkips, handleDetection, handleFrameError, sendCloudFrame],
  );

  const onFrameDropped = useCallback(() => {
    droppedCount.current += 1;
  }, []);

  const frameOutput = useFrameOutput({ pixelFormat: 'yuv', dropFramesWhileBusy: true, onFrame, onFrameDropped });

  useLayoutEffect(() => {
    detector?.setFrameOutput(frameOutput);
    encoder?.setFrameOutput(frameOutput);
  }, [detector, encoder, frameOutput]);

  // Publish fps and the drop count at most every 500 ms, so frames do not drive re-renders.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - FPS_WINDOW_MS;
      processedAt.current = processedAt.current.filter((t) => t > cutoff);
      setFps(processedAt.current.length);
      setDropped(droppedCount.current + deliverySkips.getDirty());
    }, STATS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [deliverySkips]);

  if (isCloud) {
    return {
      frameOutput,
      fps,
      error: encoderError ?? frameError,
      model: cloudModel ?? 'cloud',
      dropped,
      cloudStatus: cloudConfig ? cloudStatus : 'stopped',
    };
  }
  return {
    frameOutput,
    fps,
    error: createError ?? frameError,
    model: detector?.model ?? null,
    dropped,
    cloudStatus: null,
  };
}
