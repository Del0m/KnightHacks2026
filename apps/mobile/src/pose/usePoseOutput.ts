import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createBasicPoseDetector, createPoseDetector } from 'spotter-pose';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { shouldProcess } from './throttle';
import type { PoseDetection } from './types';

const FPS_WINDOW_MS = 1000;

/** `coreml` runs YOLOv8n-pose; `vision` runs Apple Vision body pose (basic mode, see `basic.ts`). */
export type PoseEngine = 'coreml' | 'vision';
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
  /** Frames the camera pipeline dropped (`onFrameDropped`), since mount. */
  dropped: number;
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
}): PoseOutput {
  const { engine = 'coreml', size = 320, maxFps = 15, onPose } = opts;

  const created = useMemo(() => {
    try {
      const detector = engine === 'vision' ? createBasicPoseDetector() : createPoseDetector(size);
      return { detector, createError: null };
    } catch (e) {
      return { detector: null, createError: String(e) };
    }
  }, [engine, size]);
  const { detector, createError } = created;

  const [frameError, setFrameError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [dropped, setDropped] = useState(0);

  // Last processed frame time (ms), shared with the frame thread. Null until the first frame.
  const lastMs = useMemo(() => createSynchronizable<number | null>(null), []);

  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;
  const processedAt = useRef<number[]>([]);
  const droppedCount = useRef(0);
  const failedCount = useRef(0);

  const handleDetection = useCallback((d: PoseDetection) => {
    processedAt.current.push(Date.now());
    onPoseRef.current(d);
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
    [detector, maxFps, lastMs, handleDetection, handleFrameError],
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

  return {
    frameOutput,
    fps,
    error: createError ?? frameError,
    model: detector?.model ?? null,
    dropped,
  };
}
