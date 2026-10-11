import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createBasicPoseDetector, createPoseDetector } from 'steadyforum-pose';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { CloudPoseClient, encodeFrame, type CloudState, type CreateSocket } from './cloud';
import { frameToCloudJpeg } from './cloudFrame';
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

export interface CloudConfig {
  /** The relay's WebSocket URL, from `poseStreamUrl(apiUrl)`. */
  url: string;
  /** A fresh Neon Auth token for each connection (`authClient.token()`). Never the HF token. */
  getToken: () => Promise<string | null>;
  createSocket?: CreateSocket; // tests
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
  /** Frames the camera pipeline dropped (`onFrameDropped`), plus frames the cloud relay skipped, since mount. */
  dropped: number;
  /** Cloud mode only: 'reconnecting' while the endpoint warms up or after a drop (show "reconnecting"). */
  cloudState: CloudState | null;
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
  /** Required for `engine: 'cloud'`. */
  cloud?: CloudConfig;
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

  const [frameError, setFrameError] = useState<string | null>(null);
  const [cloudState, setCloudState] = useState<CloudState | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudModel, setCloudModel] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [dropped, setDropped] = useState(0);

  // Last processed frame time (ms), shared with the frame thread. Null until the first frame.
  const lastMs = useMemo(() => createSynchronizable<number | null>(null), []);

  const onPoseRef = useRef(onPose);
  useLayoutEffect(() => { onPoseRef.current = onPose; }, [onPose]);
  const processedAt = useRef<number[]>([]);
  const droppedCount = useRef(0);
  const failedCount = useRef(0);

  const handleDetection = useCallback((d: PoseDetection) => {
    processedAt.current.push(Date.now());
    onPoseRef.current(d);
  }, []);

  // Cloud mode: one client per URL; frames from the worklet go to it on the JS thread.
  const cloudClient = useRef<CloudPoseClient | null>(null);
  const getTokenRef = useRef(cloud?.getToken);
  useLayoutEffect(() => { getTokenRef.current = cloud?.getToken; }, [cloud?.getToken]);
  const cloudUrl = isCloud ? cloud?.url ?? null : null;
  const createSocket = cloud?.createSocket;
  useEffect(() => {
    if (!cloudUrl) return;
    const client = new CloudPoseClient({
      url: cloudUrl,
      getToken: () => getTokenRef.current?.() ?? Promise.resolve(null),
      createSocket,
      onPose: (d, skipped) => {
        droppedCount.current += skipped;
        if (d.result) setCloudModel((m) => (m === d.result!.model ? m : d.result!.model));
        handleDetection(d);
      },
      onState: (state, error) => { setCloudState(state); setCloudError(error); },
    });
    cloudClient.current = client;
    client.start();
    return () => {
      client.close();
      if (cloudClient.current === client) cloudClient.current = null;
    };
  }, [cloudUrl, createSocket, handleDetection]);

  const sendCloudFrame = useCallback((timestampMs: number, jpeg: ArrayBuffer) => {
    cloudClient.current?.send(encodeFrame(timestampMs, jpeg));
  }, []);

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
          if (!shouldProcess(nowMs, lastMs.getDirty(), maxFps)) return;
          lastMs.setBlocking(nowMs);
          // Encoded here, off the JS thread; only the JPEG bytes cross to the socket.
          scheduleOnRN(sendCloudFrame, Date.now(), frameToCloudJpeg(frame));
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
    [detector, isCloud, maxFps, lastMs, handleDetection, handleFrameError, sendCloudFrame],
  );

  const onFrameDropped = useCallback(() => {
    droppedCount.current += 1;
  }, []);

  const frameOutput = useFrameOutput({ pixelFormat: 'yuv', dropFramesWhileBusy: true, onFrame, onFrameDropped });

  useLayoutEffect(() => {
    detector?.setFrameOutput(frameOutput);
  }, [detector, frameOutput]);

  // Publish fps and the drop count at most every 500 ms, so frames do not drive re-renders.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - FPS_WINDOW_MS;
      processedAt.current = processedAt.current.filter((t) => t > cutoff);
      setFps(processedAt.current.length);
      setDropped(droppedCount.current);
    }, STATS_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (isCloud) {
    return {
      frameOutput,
      fps,
      error: (cloud ? null : 'Cloud mode needs the API URL and a signed-in session.') ?? cloudError ?? frameError,
      model: cloudModel ?? (cloud ? 'cloud' : null),
      dropped,
      cloudState,
    };
  }
  return {
    frameOutput,
    fps,
    error: createError ?? frameError,
    model: detector?.model ?? null,
    dropped,
    cloudState: null,
  };
}
