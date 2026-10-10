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
}

export interface PoseDetector extends HybridObject<{ ios: 'swift' }> {
  readonly model: string
  setFrameOutput(output: CameraFrameOutput): void
  detect(frame: Frame): PoseDetection
}

export interface PoseDetectorFactory extends HybridObject<{ ios: 'swift' }> {
  createPoseDetector(size: number): PoseDetector  // 320 or 256; anything else throws
  createBasicPoseDetector(): PoseDetector         // Apple Vision body pose; no bundled model
}
