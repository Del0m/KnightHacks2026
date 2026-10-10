// Spec metrics from smoothed joints. Behaviour: docs/superpowers/specs/2026-10-10-form-engine-design.md §2.

import { JOINT_NAMES, type Joint } from '../pose/types';
import type {
  AngleSpec,
  ExerciseSpec,
  MetricSide,
  MetricSides,
  Metrics,
  Point,
  SideMode,
  SmoothedJoints,
} from './types';

/** A 2D point. The geometry helpers expect aspect-corrected coordinates (`X = x * imageAspect`). */
export interface Vec {
  x: number;
  y: number;
}

export interface MetricComputerOptions {
  /** Upright width ÷ height. Default 9/16. */
  imageAspect?: number;
  /** Default 0.1. */
  sideMargin?: number;
  /** Default 0.02, in aspect-corrected units. */
  minRatioDenominator?: number;
}

export interface MetricComputer {
  compute(joints: SmoothedJoints): { metrics: Metrics; sides: MetricSides };
  /** Keeps every `most_visible` side fixed while true (except the null fallback). */
  setLocked(locked: boolean): void;
  reset(): void;
}

type Side = 'left' | 'right';

const EPS = 1e-9;
const DEG = 180 / Math.PI;

/** Interior angle at `vertex`, 0–180°. Null if either segment has zero length. */
export function jointAngle(a: Vec, vertex: Vec, c: Vec): number | null {
  const ux = a.x - vertex.x;
  const uy = a.y - vertex.y;
  const wx = c.x - vertex.x;
  const wy = c.y - vertex.y;
  if (Math.hypot(ux, uy) < EPS || Math.hypot(wx, wy) < EPS) return null;
  return Math.atan2(Math.abs(ux * wy - uy * wx), ux * wx + uy * wy) * DEG;
}

/** Unsigned angle between `from→to` and image-up (−y), 0–180°. Null if the points coincide. */
export function segmentTilt(from: Vec, to: Vec): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < EPS) return null;
  return Math.atan2(Math.abs(dx), -dy) * DEG;
}

/** `|Xa − Xb| / |Xc − Xd|`, or null when the denominator is below `minDen`. */
export function widthRatio(a: Vec, b: Vec, c: Vec, d: Vec, minDen: number): number | null {
  const den = Math.abs(c.x - d.x);
  if (den < minDen || den < EPS) return null;
  return Math.abs(a.x - b.x) / den;
}

const jointIndex = new Map(JOINT_NAMES.map((name, i) => [name, i]));

const isUnsided = (point: Point): boolean =>
  !jointIndex.has(point) && !point.startsWith('mid_') && jointIndex.has(`left_${point}`);

const joint = (name: string, joints: SmoothedJoints): Joint | null => {
  const i = jointIndex.get(name);
  return i === undefined ? null : (joints[i] ?? null);
};

/**
 * The joint for a spec point: a COCO name, an unsided base on `side`, or `mid_<base>` (the mean of
 * whichever of the two sides is present, including its `c`). Null if missing or unknown.
 */
export function resolvePoint(point: Point, side: Side, joints: SmoothedJoints): Joint | null {
  if (jointIndex.has(point)) return joint(point, joints);
  if (point.startsWith('mid_')) {
    const base = point.slice(4);
    const present = [joint(`left_${base}`, joints), joint(`right_${base}`, joints)].filter(
      (j): j is Joint => j !== null,
    );
    if (present.length === 0) return null;
    const mean = (k: keyof Joint) => present.reduce((s, j) => s + j[k], 0) / present.length;
    return { x: mean('x'), y: mean('y'), c: mean('c') };
  }
  return joint(`${side}_${point}`, joints);
}

const pointsOf = (spec: AngleSpec): Point[] => {
  switch (spec.type) {
    case 'joint_angle':
      return [...spec.joints];
    case 'segment_tilt':
      return [spec.from, spec.to];
    case 'width_ratio':
      return [...spec.numerator, ...spec.denominator];
  }
};

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

interface SideReading {
  value: number | null;
  /** Mean raw `c` over the resolved points; a missing point counts as 0. */
  visibility: number;
}

/** Computes every metric of `spec` each frame, keeping a sticky side per `most_visible` metric. */
export function createMetricComputer(spec: ExerciseSpec, opts: MetricComputerOptions = {}): MetricComputer {
  const imageAspect = opts.imageAspect ?? 9 / 16;
  const sideMargin = opts.sideMargin ?? 0.1;
  const minDen = opts.minRatioDenominator ?? 0.02;
  const entries = Object.entries(spec.angles).map(([name, angle]) => ({
    name,
    angle,
    /** The angle again, narrowed, when it is read per side; null otherwise. */
    sided: angle.type !== 'width_ratio' && pointsOf(angle).some(isUnsided) ? angle : null,
  }));
  const chosen = new Map<string, Side>();
  let locked = false;

  const read = (angle: AngleSpec, side: Side, joints: SmoothedJoints): SideReading => {
    const resolved = pointsOf(angle).map((p) => resolvePoint(p, side, joints));
    const visibility = resolved.reduce((s, j) => s + (j?.c ?? 0), 0) / resolved.length;
    if (resolved.some((j) => j === null)) return { value: null, visibility };
    const v = (resolved as Joint[]).map((j) => ({ x: j.x * imageAspect, y: j.y }));
    switch (angle.type) {
      case 'joint_angle':
        return { value: jointAngle(v[0], v[1], v[2]), visibility };
      case 'segment_tilt':
        return { value: segmentTilt(v[0], v[1]), visibility };
      case 'width_ratio':
        return { value: widthRatio(v[0], v[1], v[2], v[3], minDen), visibility };
    }
  };

  const mostVisible = (name: string, r: Record<Side, SideReading>): Side => {
    let side = chosen.get(name);
    if (side === undefined) {
      side = r.right.visibility > r.left.visibility ? 'right' : 'left';
    } else if (!locked && r[other(side)].visibility >= r[side].visibility + sideMargin - EPS) {
      side = other(side);
    }
    if (r[side].value === null && r[other(side)].value !== null) side = other(side);
    chosen.set(name, side);
    return side;
  };

  const sided = (
    name: string,
    angle: AngleSpec,
    mode: SideMode,
    joints: SmoothedJoints,
  ): [number | null, MetricSide | null] => {
    const r = { left: read(angle, 'left', joints), right: read(angle, 'right', joints) };
    const present = (['left', 'right'] as const).filter((s) => r[s].value !== null);
    if (mode === 'left' || mode === 'right') return [r[mode].value, r[mode].value === null ? null : mode];
    if (mode === 'most_visible') {
      const side = mostVisible(name, r);
      return r[side].value === null ? [null, null] : [r[side].value, side];
    }
    if (present.length === 0) return [null, null];
    if (present.length === 1) return [r[present[0]].value, present[0]];
    const [l, rt] = [r.left.value as number, r.right.value as number];
    if (mode === 'both_avg') return [(l + rt) / 2, 'both'];
    const pickLeft = mode === 'min' ? l <= rt : l >= rt;
    return pickLeft ? [l, 'left'] : [rt, 'right'];
  };

  return {
    compute(joints) {
      const metrics: Metrics = {};
      const sides: MetricSides = {};
      for (const { name, angle, sided: sidedAngle } of entries) {
        let value: number | null;
        let side: MetricSide | null;
        if (sidedAngle) {
          [value, side] = sided(name, sidedAngle, sidedAngle.side ?? 'most_visible', joints);
        } else {
          value = read(angle, 'left', joints).value;
          side = value === null ? null : 'both';
        }
        metrics[name] = value;
        sides[name] = side;
      }
      return { metrics, sides };
    },
    setLocked(next) {
      locked = next;
    },
    reset() {
      chosen.clear();
      locked = false;
    },
  };
}
