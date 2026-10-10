import { JOINT_NAMES, type Joint } from '../../pose/types';
import { DEFAULT_ONE_EURO, JointSmoother, OneEuroFilter } from '../oneEuro';

/** Seeded Gaussian noise (Park–Miller LCG + Box–Muller). */
const gaussian = (seed: number) => {
  let s = seed;
  const uniform = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
};

const std = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
};

/** Std of filtered / std of raw for a still joint at 0.5. */
const jitterRatio = (fps: number, sigma: number, seed: number) => {
  const noise = gaussian(seed);
  const f = new OneEuroFilter();
  const raw: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const v = 0.5 + sigma * noise();
    raw.push(v);
    out.push(f.filter(v, (i * 1000) / fps));
  }
  return std(out.slice(30)) / std(raw.slice(30));
};

/** Delay (ms) that best aligns the filtered output with a 1 Hz sinusoid of amplitude 0.1. */
const sineLagMs = (fps: number, sigma: number, seed: number) => {
  const noise = gaussian(seed);
  const f = new OneEuroFilter();
  const wave = (t: number) => 0.5 + 0.1 * Math.sin((2 * Math.PI * t) / 1000);
  const samples: { t: number; y: number }[] = [];
  for (let i = 0; i < fps * 20; i++) {
    const t = (i * 1000) / fps;
    samples.push({ t, y: f.filter(wave(t) + sigma * noise(), t) });
  }
  const settled = samples.slice(fps * 2);
  let best = 0;
  let bestErr = Infinity;
  for (let d = 0; d <= 200; d++) {
    const err = settled.reduce((e, s) => e + (s.y - wave(s.t - d)) ** 2, 0);
    if (err < bestErr) {
      bestErr = err;
      best = d;
    }
  }
  return best;
};

describe('OneEuroFilter', () => {
  it('passes the first sample through', () => {
    expect(new OneEuroFilter().filter(0.42, 1000)).toBe(0.42);
  });

  it('returns the previous output and keeps its state when dt <= 0', () => {
    const f = new OneEuroFilter();
    f.filter(0.5, 0);
    const y1 = f.filter(0.6, 80);
    expect(f.filter(0.9, 80)).toBe(y1);
    expect(f.filter(0.9, 40)).toBe(y1);

    const g = new OneEuroFilter();
    g.filter(0.5, 0);
    g.filter(0.6, 80);
    expect(f.filter(0.7, 160)).toBe(g.filter(0.7, 160));
  });

  it('starts over after reset', () => {
    const f = new OneEuroFilter();
    f.filter(0.1, 0);
    f.filter(0.2, 80);
    f.reset();
    expect(f.filter(0.9, 160)).toBe(0.9);
  });

  it('uses the defaults for omitted params', () => {
    const a = new OneEuroFilter({ beta: undefined });
    const b = new OneEuroFilter(DEFAULT_ONE_EURO);
    for (let i = 0; i < 10; i++) expect(a.filter(Math.sin(i), i * 70)).toBe(b.filter(Math.sin(i), i * 70));
  });

  it.each([
    [10, 0.003],
    [10, 0.008],
    [12.5, 0.006],
    [15, 0.003],
    [15, 0.008],
  ])('cuts still-joint jitter by at least half at %p fps, σ=%p', (fps, sigma) => {
    expect(jitterRatio(fps, sigma, 7)).toBeLessThanOrEqual(0.5);
  });

  it.each([
    [10, 0],
    [10, 0.006],
    [12.5, 0.006],
    [15, 0.006],
  ])('lags a 1 Hz movement by under 60 ms at %p fps, σ=%p', (fps, sigma) => {
    expect(sineLagMs(fps, sigma, 11)).toBeLessThan(60);
  });
});

const frame = (overrides: Record<number, Joint> = {}, base: Joint = { x: 0.5, y: 0.5, c: 0.9 }) =>
  JOINT_NAMES.map((_, i) => overrides[i] ?? base);

describe('JointSmoother', () => {
  it('returns 17 joints, the first frame unchanged', () => {
    const s = new JointSmoother();
    const joints = JOINT_NAMES.map((_, i) => ({ x: i / 20, y: 1 - i / 20, c: 0.8 }));
    expect(s.push(joints, 0)).toEqual(joints);
  });

  it('filters x and y separately per joint', () => {
    const s = new JointSmoother();
    s.push(frame(), 0);
    const out = s.push(frame({ 3: { x: 0.6, y: 0.5, c: 0.9 } }), 80);
    expect(out[3]!.x).toBeGreaterThan(0.5);
    expect(out[3]!.x).toBeLessThan(0.6);
    expect(out[3]!.y).toBe(0.5);
    expect(out[4]).toEqual({ x: 0.5, y: 0.5, c: 0.9 });
  });

  it('holds a low-confidence joint for holdMs with the current c, then drops it', () => {
    const s = new JointSmoother();
    const good = s.push(frame(), 0)[0]!;
    const low = { x: 0.9, y: 0.9, c: 0.1 };
    expect(s.push(frame({ 0: low }), 100)[0]).toEqual({ x: good.x, y: good.y, c: 0.1 });
    expect(s.push(frame({ 0: low }), 300)[0]).toEqual({ x: good.x, y: good.y, c: 0.1 });
    expect(s.push(frame({ 0: low }), 301)[0]).toBeNull();
  });

  it('treats c exactly at minConfidence as good', () => {
    const s = new JointSmoother({ minConfidence: 0.5 });
    expect(s.push(frame({}, { x: 0.2, y: 0.3, c: 0.5 }), 0)[0]).toEqual({ x: 0.2, y: 0.3, c: 0.5 });
  });

  it('is null for a joint never seen confidently', () => {
    const s = new JointSmoother();
    expect(s.push(frame({ 5: { x: 0.5, y: 0.5, c: 0.2 } }), 0)[5]).toBeNull();
    expect(s.push(frame({ 5: { x: 0.5, y: 0.5, c: 0.2 } }), 80)[5]).toBeNull();
  });

  it('continues smoothing across a short low-confidence hold', () => {
    const s = new JointSmoother();
    s.push(frame(), 0);
    s.push(frame({ 0: { x: 0.5, y: 0.5, c: 0.1 } }), 80);
    const out = s.push(frame({ 0: { x: 0.7, y: 0.5, c: 0.9 } }), 160)[0]!;
    expect(out.x).toBeGreaterThan(0.5);
    expect(out.x).toBeLessThan(0.7);
  });

  it('resets the filters after a gap longer than holdMs', () => {
    const s = new JointSmoother();
    s.push(frame(), 0);
    s.push(frame({ 0: { x: 0.5, y: 0.5, c: 0.1 } }), 100);
    expect(s.push(frame({ 0: { x: 0.5, y: 0.5, c: 0.1 } }), 400)[0]).toBeNull();
    expect(s.push(frame({ 0: { x: 0.8, y: 0.2, c: 0.9 } }), 480)[0]).toEqual({ x: 0.8, y: 0.2, c: 0.9 });
  });

  it('resets after a no-person gap (push skipped) longer than holdMs', () => {
    const s = new JointSmoother();
    s.push(frame(), 0);
    expect(s.push(frame({}, { x: 0.8, y: 0.2, c: 0.9 }), 1000)[0]).toEqual({ x: 0.8, y: 0.2, c: 0.9 });
  });

  it('forgets everything on reset', () => {
    const s = new JointSmoother();
    s.push(frame(), 0);
    s.reset();
    expect(s.push(frame({ 0: { x: 0.5, y: 0.5, c: 0.1 } }), 80)[0]).toBeNull();
    expect(s.push(frame({}, { x: 0.8, y: 0.2, c: 0.9 }), 160)[0]).toEqual({ x: 0.8, y: 0.2, c: 0.9 });
  });

  it('passes filter params through', () => {
    const s = new JointSmoother({ filter: { minCutoff: 1000, beta: 0 } });
    s.push(frame(), 0);
    expect(s.push(frame({}, { x: 0.8, y: 0.2, c: 0.9 }), 80)[0]!.x).toBeCloseTo(0.8, 2);
  });
});
