// Camera frame -> the JPEG cloud mode sends (AI-17). Runs inside the frame worklet, so encoding
// stays off the JS thread: VisionCamera converts the frame to a nitro-image Image, which resizes
// and encodes natively (iOS and Android). Frames are never written to disk.
//
// Orientation and mirroring are applied exactly once, by the conversion, never here:
//   Android  HybridFrameConverter calls ImageProxy.toBitmap(orientation, isMirrored): the bitmap is
//            already upright and unmirrored.
//   iOS      it wraps the pixels in a UIImage tagged with frame.metadata.uiImageOrientation (which
//            includes mirroring). Pixels stay as captured; anything that *draws* the image honours
//            the tag. nitro-image's resize draws, so it bakes the orientation into upright pixels.
//            Encoding alone (jpegData) would only write an EXIF tag the server may ignore.
// So the image is always redrawn through resize, even when it's already small enough.
// (Checked against VisionCamera 5.2.3 and nitro-image 0.15.2; confirm on a phone.)
import type { Frame } from 'react-native-vision-camera';
import { HybridFrameConverter } from 'react-native-vision-camera';

/** The relay expects ~320 px on the long side (apps/api/src/routes/poseStream.ts). */
export const CLOUD_LONG_SIDE = 320;
export const CLOUD_JPEG_QUALITY = 70;

/** Width and height that fit `longSide` on the longer edge, keeping the aspect ratio. Never upscales. */
export function scaledSize(width: number, height: number, longSide = CLOUD_LONG_SIDE): { width: number; height: number } {
  'worklet';
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The frame as an upright, unmirrored JPEG about 320 px on the long side. */
export function frameToCloudJpeg(frame: Frame): ArrayBuffer {
  'worklet';
  // Width and height here are the upright size: the conversion already accounts for orientation.
  const image = HybridFrameConverter.convertFrameToImage(frame);
  const size = scaledSize(image.width, image.height);
  // Always redraw (never skipped when no scaling is needed): on iOS this is what applies the
  // orientation tag to the pixels.
  return image.resize(size.width, size.height).toEncodedImageData('jpg', CLOUD_JPEG_QUALITY).buffer;
}
