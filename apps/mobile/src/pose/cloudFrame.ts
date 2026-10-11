// Camera frame -> the JPEG cloud mode sends (AI-17). Runs inside the frame worklet, so encoding
// stays off the JS thread: VisionCamera converts the frame to a nitro-image Image, which rotates,
// resizes and encodes natively (iOS and Android). Frames are never written to disk.
import type { Frame } from 'react-native-vision-camera';
import { HybridFrameConverter } from 'react-native-vision-camera';

/** The relay expects ~320 px on the long side (apps/api/src/routes/poseStream.ts). */
export const CLOUD_LONG_SIDE = 320;
export const CLOUD_JPEG_QUALITY = 70;

/**
 * Degrees to rotate the frame's pixels to make them upright. VisionCamera's `orientation` says how
 * the pixel data is rotated relative to upright ('right' = +90°), so this counter-rotates.
 * Checked against the docs only: confirm on a phone that cloud frames arrive upright.
 */
export function uprightDegrees(orientation: 'up' | 'right' | 'down' | 'left'): number {
  'worklet';
  switch (orientation) {
    case 'right': return -90;
    case 'left': return 90;
    case 'down': return 180;
    default: return 0;
  }
}

/** Width and height that fit `longSide` on the longer edge, keeping the aspect ratio. */
export function scaledSize(width: number, height: number, longSide = CLOUD_LONG_SIDE): { width: number; height: number } {
  'worklet';
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The frame as an upright, unmirrored JPEG about 320 px on the long side. */
export function frameToCloudJpeg(frame: Frame): ArrayBuffer {
  'worklet';
  let image = HybridFrameConverter.convertFrameToImage(frame);
  const degrees = uprightDegrees(frame.orientation);
  if (degrees !== 0) image = image.rotate(degrees, false);
  if (frame.isMirrored) image = image.mirrorHorizontally();
  const size = scaledSize(image.width, image.height);
  if (size.width !== image.width) image = image.resize(size.width, size.height);
  return image.toEncodedImageData('jpg', CLOUD_JPEG_QUALITY).buffer;
}
