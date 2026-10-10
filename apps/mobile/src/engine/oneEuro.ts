// One Euro filter (Casiez, Roussel and Vogel, CHI 2012) and the per-joint smoother built on it.
// Behaviour: docs/superpowers/specs/2026-10-10-form-engine-design.md §1.

import { JOINT_NAMES, type Joint } from '../pose/types';
import type { OneEuroParams, SmoothedJoints } from './types';

/**
 * Tuned for normalized (0–1) joint positions at 10–15 fps with per-joint noise σ ≈ 0.003–0.008.
 * Normalized speeds are about 0.1–2 units/s, so `beta` is far larger than the usual pixel-space
 * values. Across 10–15 fps and σ 0.003–0.008, a still joint's jitter (std) drops by 54–69%, and a
 * 1 Hz movement of amplitude 0.1 lags by 45–49 ms (`__tests__/oneEuro.test.ts` checks both).
 */
export const DEFAULT_ONE_EURO: OneEuroParams = {
  minCutoff: 0.3,
  beta: 8,
  dCutoff: 1.0,
};

const alpha = (cutoffHz: number, dtS: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

const resolveParams = (params: Partial<OneEuroParams> = {}): OneEuroParams => ({
  minCutoff: params.minCutoff ?? DEFAULT_ONE_EURO.minCutoff,
  beta: params.beta ?? DEFAULT_ONE_EURO.beta,
  dCutoff: params.dCutoff ?? DEFAULT_ONE_EURO.dCutoff,
});

/** One scalar signal. Time is in ms. */
export class OneEuroFilter {
  private readonly params: OneEuroParams;
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(params?: Partial<OneEuroParams>) {
    this.params = resolveParams(params);
  }

  /** The filtered value. The first sample passes through; `dt <= 0` returns the previous output. */
  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = tMs;
      return value;
    }
    const dt = (tMs - this.t) / 1000;
    if (!(dt > 0)) return this.x;

    const { minCutoff, beta, dCutoff } = this.params;
    const rawDx = (value - this.x) / dt;
    const aD = alpha(dCutoff, dt);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    const a = alpha(cutoff, dt);
    this.x = a * value + (1 - a) * this.x;
    this.t = tMs;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }
}

export interface JointSmootherOptions {
  filter?: Partial<OneEuroParams>;
  /** Default 0.3. */
  minConfidence?: number;
  /** Default 300 ms. */
  holdMs?: number;
}

interface JointTrack {
  fx: OneEuroFilter;
  fy: OneEuroFilter;
  /** Time of the last sample at or above `minConfidence`, or null if never seen. */
  lastGoodT: number | null;
  x: number;
  y: number;
}

/** Smooths the 17 joints: one filter each for x and y, a confidence hold, and a reset after gaps. */
export class JointSmoother {
  private readonly minConfidence: number;
  private readonly holdMs: number;
  private readonly tracks: JointTrack[];

  constructor(opts: JointSmootherOptions = {}) {
    this.minConfidence = opts.minConfidence ?? 0.3;
    this.holdMs = opts.holdMs ?? 300;
    this.tracks = JOINT_NAMES.map(() => ({
      fx: new OneEuroFilter(opts.filter),
      fy: new OneEuroFilter(opts.filter),
      lastGoodT: null,
      x: 0,
      y: 0,
    }));
  }

  push(joints: Joint[], tMs: number): SmoothedJoints {
    return this.tracks.map((track, i) => {
      const j = joints[i];
      const fresh = track.lastGoodT !== null && tMs - track.lastGoodT <= this.holdMs;
      if (j && j.c >= this.minConfidence) {
        if (!fresh) {
          track.fx.reset();
          track.fy.reset();
        }
        track.x = track.fx.filter(j.x, tMs);
        track.y = track.fy.filter(j.y, tMs);
        track.lastGoodT = Math.max(tMs, track.lastGoodT ?? tMs);
        return { x: track.x, y: track.y, c: j.c };
      }
      return fresh ? { x: track.x, y: track.y, c: j?.c ?? 0 } : null;
    });
  }

  reset(): void {
    for (const track of this.tracks) {
      track.fx.reset();
      track.fy.reset();
      track.lastGoodT = null;
    }
  }
}
