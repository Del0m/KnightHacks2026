import { NitroModules } from 'react-native-nitro-modules'
import type { PoseDetector, PoseDetectorFactory } from './specs/PoseDetector.nitro'

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

export type { PoseDetector, PoseDetection, PoseResult, Joint } from './specs/PoseDetector.nitro'
