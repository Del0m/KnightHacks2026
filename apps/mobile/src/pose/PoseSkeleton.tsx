import type React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { jointToView, type Fit } from './overlayGeometry';
import { BONES, type PoseResult } from './types';

/** Joints below this confidence are not drawn. */
const MIN_CONFIDENCE = 0.3;
const JOINT_RADIUS = 4;
const COLOR = '#00E676';

/**
 * Draws the pose over the camera preview. `imageSize` is the upright frame size, `viewSize` the
 * preview view size, `mirrored` true for a mirrored (front camera) preview, `fit` the preview's resize mode.
 */
export function PoseSkeleton(props: {
  result: PoseResult | undefined;
  imageSize: { width: number; height: number };
  viewSize: { width: number; height: number };
  mirrored: boolean;
  fit: Fit;
}): React.JSX.Element | null {
  const { result, imageSize, viewSize, mirrored, fit } = props;
  if (result === undefined) return null;

  const points = result.joints.map((j) => jointToView(j, imageSize, viewSize, mirrored, fit));
  const visible = result.joints.map((j) => j.c >= MIN_CONFIDENCE);

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={viewSize.width}
      height={viewSize.height}
      pointerEvents="none"
    >
      {BONES.map(([a, b]) =>
        visible[a] && visible[b] ? (
          <Line
            key={`bone-${a}-${b}`}
            x1={points[a].x}
            y1={points[a].y}
            x2={points[b].x}
            y2={points[b].y}
            stroke={COLOR}
            strokeWidth={3}
          />
        ) : null,
      )}
      {points.map((p, i) =>
        visible[i] ? <Circle key={`joint-${i}`} cx={p.x} cy={p.y} r={JOINT_RADIUS} fill={COLOR} /> : null,
      )}
    </Svg>
  );
}
