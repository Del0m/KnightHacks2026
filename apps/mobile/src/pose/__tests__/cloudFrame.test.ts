// The converter/image boundary of frameToCloudJpeg, with fakes that record every native call.
// VisionCamera's convertFrameToImage already applies frame.orientation and frame.isMirrored
// (Android bakes them into the bitmap; iOS tags the UIImage, and nitro-image's resize draws it
// upright), so the frame must be normalised exactly once: no rotate or mirror here, and always a
// resize, which is the redraw that applies the iOS tag.
import type { Frame } from 'react-native-vision-camera';
import { HybridFrameConverter } from 'react-native-vision-camera';
import { CLOUD_JPEG_QUALITY, frameToCloudJpeg } from '../cloudFrame';

jest.mock('react-native-vision-camera', () => ({ HybridFrameConverter: { convertFrameToImage: jest.fn() } }));

type Call = [string, ...unknown[]];

/** A nitro-image Image stand-in of the given (upright) size that logs what is called on it. */
function fakeImage(calls: Call[], width: number, height: number, tag = 'converted'): unknown {
  return {
    width,
    height,
    rotate: (...a: unknown[]) => { calls.push(['rotate', tag, ...a]); return fakeImage(calls, height, width, 'rotated'); },
    mirrorHorizontally: () => { calls.push(['mirrorHorizontally', tag]); return fakeImage(calls, width, height, 'mirrored'); },
    resize: (w: number, h: number) => { calls.push(['resize', tag, w, h]); return fakeImage(calls, w, h, 'resized'); },
    toEncodedImageData: (format: string, quality: number) => {
      calls.push(['toEncodedImageData', tag, format, quality]);
      return { buffer: new Uint8Array([0xff, 0xd8]).buffer, width, height };
    },
  };
}

describe('frameToCloudJpeg', () => {
  const cases: [string, Partial<Frame>, number, number, [number, number]][] = [
    // Converted sizes are already upright, whatever the frame's buffer orientation was.
    ['portrait, rotated buffer', { orientation: 'right', isMirrored: false }, 1080, 1920, [180, 320]],
    ['landscape', { orientation: 'up', isMirrored: false }, 1920, 1080, [320, 180]],
    ['upside down, mirrored front camera', { orientation: 'down', isMirrored: true }, 1080, 1920, [180, 320]],
    ['already small', { orientation: 'left', isMirrored: false }, 240, 160, [240, 160]],
  ];

  it.each(cases)('%s: converts once, never rotates or mirrors again, always redraws, then encodes', (_name, frame, w, h, size) => {
    const calls: Call[] = [];
    jest.mocked(HybridFrameConverter.convertFrameToImage).mockReturnValue(fakeImage(calls, w, h) as never);

    const jpeg = frameToCloudJpeg(frame as Frame);

    expect(HybridFrameConverter.convertFrameToImage).toHaveBeenCalledWith(frame);
    expect(calls).toEqual([
      ['resize', 'converted', ...size],
      ['toEncodedImageData', 'resized', 'jpg', CLOUD_JPEG_QUALITY],
    ]);
    expect(Array.from(new Uint8Array(jpeg))).toEqual([0xff, 0xd8]);
  });
});
