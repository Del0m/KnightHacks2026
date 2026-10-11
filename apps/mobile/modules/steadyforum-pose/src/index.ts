import { NitroModules } from 'react-native-nitro-modules'
import type { CloudFrameEncoder, PoseBenchmark, PoseDetector, PoseDetectorFactory } from './specs/PoseDetector.nitro'

let factory: PoseDetectorFactory | undefined

/**
 * Creates a native pose detector for the given model input size (320 or 256).
 * Throws for any other size, or when the model is not bundled in the app.
 */
export function createPoseDetector(size: number): PoseDetector {
  factory ??= NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')
  return factory.createPoseDetector(size)
}

/** Creates the Apple Vision body-pose detector (basic mode, iPhone only). */
export function createBasicPoseDetector(): PoseDetector {
  factory ??= NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')
  return factory.createBasicPoseDetector()
}

/** Creates the encoder that turns camera frames into upright JPEGs for the cloud pose relay (iPhone only). */
export function createCloudFrameEncoder(): CloudFrameEncoder {
  factory ??= NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')
  return factory.createCloudFrameEncoder()
}

/** Fingerprint of the bundled YOLOv8 models; changes when a model is re-exported or replaced. */
export function getPoseModelId(): string {
  factory ??= NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')
  return factory.poseModelId()
}

/**
 * Runs YOLOv8 back to back on a synthetic frame: discards `warmUpMs`, then measures for `measureMs`.
 * Rejects when the model is missing or fails to load.
 */
export function benchmarkPoseModel(size: number, warmUpMs: number, measureMs: number): Promise<PoseBenchmark> {
  factory ??= NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')
  return factory.benchmarkPoseModel(size, warmUpMs, measureMs)
}

export type {
  CloudFrame, CloudFrameEncoder, PoseBenchmark, PoseDetector, PoseDetection, PoseResult, Joint,
} from './specs/PoseDetector.nitro'
