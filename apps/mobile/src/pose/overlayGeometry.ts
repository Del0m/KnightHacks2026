// Port of PoseCore's OverlayGeometry.point (OverlayGeometry.swift), plus a 'cover' fit.

/** How the preview fills its view: 'contain' letterboxes (aspect-fit), 'cover' crops (aspect-fill). */
export type Fit = 'contain' | 'cover';

/**
 * Maps a normalized joint (upright, unmirrored image) to view points. `mirrored` flips x so the
 * drawn joint sits on the body part seen in a mirrored front-camera preview.
 */
export function jointToView(
  j: { x: number; y: number },
  image: { width: number; height: number },
  view: { width: number; height: number },
  mirrored: boolean,
  fit: Fit,
): { x: number; y: number } {
  'worklet';
  const sx = view.width / image.width;
  const sy = view.height / image.height;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const fittedWidth = image.width * scale;
  const fittedHeight = image.height * scale;
  const originX = (view.width - fittedWidth) / 2;
  const originY = (view.height - fittedHeight) / 2;
  const x = mirrored ? 1 - j.x : j.x;
  return { x: originX + x * fittedWidth, y: originY + j.y * fittedHeight };
}
