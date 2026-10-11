import type { HybridObject } from 'react-native-nitro-modules'
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera'

export interface Joint { x: number; y: number; c: number }

export interface PoseResult {
  source: string        // "coreml" or "vision"
  model: string         // "yolov8n-pose-320"
  timestamp_ms: number  // Unix ms
  score: number         // person confidence 0–1
  joints: Joint[]       // always 17, COCO order
}

export interface PoseDetection {
  result?: PoseResult   // undefined when no person is found
  latencyMs: number
  timestampMs?: number  // capture time, Unix ms; set even when no person is found
}

export interface PoseBenchmark {
  size: number          // 320 or 256
  model: string         // "yolov8n-pose-320"
  meanMs: number
  p95Ms: number         // nearest-rank
  samples: number       // measured inferences, after warm-up
}

export interface PoseDetector extends HybridObject<{ ios: 'swift' }> {
  readonly model: string
  setFrameOutput(output: CameraFrameOutput): void
  detect(frame: Frame): PoseDetection
}

export interface CloudFrame {
  jpeg: ArrayBuffer     // upright, unmirrored JPEG, longest side at most 320, quality 0.70
  timestampMs: number   // capture time, Unix ms
  width: number         // JPEG size in pixels
  height: number
}

export interface CloudFrameEncoder extends HybridObject<{ ios: 'swift' }> {
  setFrameOutput(output: CameraFrameOutput): void
  encode(frame: Frame): CloudFrame  // throws on failure; never disposes the frame
}

export interface PoseDetectorFactory extends HybridObject<{ ios: 'swift' }> {
  createPoseDetector(size: number): PoseDetector  // 320 or 256; anything else throws
  createBasicPoseDetector(): PoseDetector         // Apple Vision body pose; no bundled model
  poseModelId(): string                           // fingerprint of the bundled YOLOv8 models; never throws
  createCloudFrameEncoder(): CloudFrameEncoder    // JPEG frames for the cloud pose relay
  benchmarkPoseModel(size: number, warmUpMs: number, measureMs: number): Promise<PoseBenchmark>  // synthetic frame, off the JS thread
}
