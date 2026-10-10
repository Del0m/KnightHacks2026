import { createRepCounter, type RepCounter } from '../repCounter';
import type { CounterEvent, CounterStep, Phases } from '../types';

const SQUAT: Phases = {
  start_exit: 160,
  count_min: 135,
  target: 95,
  start_enter: 165,
  reverse_deg: 5,
  min_state_ms: 150,
  set_end_still_ms: 8000,
};
const SHOULDER_PRESS: Phases = { ...SQUAT, start_exit: 100, count_min: 135, target: 160, start_enter: 95 };
const PUSH_UP: Phases = { ...SQUAT, start_exit: 150, count_min: 120, target: 90, start_enter: 155 };

type Frame = [t: number, value: number | null];
type Key = [t: number, value: number | null];

/** Small seeded PRNG (mulberry32), uniform in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples keyframes at `fps` with linear interpolation. A segment touching a null keyframe yields
 * null frames. `noise` adds seeded uniform jitter of ±noise degrees.
 */
function sample(keys: Key[], opts: { fps?: number; noise?: number; seed?: number } = {}): Frame[] {
  const { fps = 15, noise = 0, seed = 1 } = opts;
  const rand = rng(seed);
  const t0 = keys[0][0];
  const tEnd = keys[keys.length - 1][0];
  const frames: Frame[] = [];
  let k = 0;
  for (let i = 0; ; i++) {
    const t = t0 + Math.round((i * 1000) / fps);
    if (t > tEnd) break;
    while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
    const [ta, va] = keys[k];
    const [tb, vb] = keys[k + 1];
    if (va === null || vb === null) {
      frames.push([t, null]);
      continue;
    }
    const u = tb === ta ? 1 : (t - ta) / (tb - ta);
    const jitter = noise ? (rand() * 2 - 1) * noise : 0;
    frames.push([t, va + (vb - va) * u + jitter]);
  }
  return frames;
}

/** Frames `dt` ms apart starting at `t0`. */
function seq(t0: number, dt: number, values: (number | null)[]): Frame[] {
  return values.map((v, i) => [t0 + i * dt, v]);
}

interface Run {
  steps: (CounterStep & { t: number; value: number | null })[];
  events: CounterEvent[];
  last: CounterStep;
}

function run(counter: RepCounter, frames: Frame[]): Run {
  const steps = frames.map(([t, value]) => ({ ...counter.step(t, value), t, value }));
  return { steps, events: steps.flatMap((s) => s.events), last: steps[steps.length - 1] };
}

const types = (events: CounterEvent[]) => events.map((e) => e.type);
const ofType = <T extends CounterEvent['type']>(events: CounterEvent[], type: T) =>
  events.filter((e): e is Extract<CounterEvent, { type: T }> => e.type === type);

/** Keyframes for `n` reps between `top` and `bottom`, 1 s down, 1 s up, 0.5 s rest at the top. */
function reps(n: number, top: number, bottom: number, t0 = 0): Key[] {
  const keys: Key[] = [[t0, top], [t0 + 500, top]];
  let t = t0 + 500;
  for (let i = 0; i < n; i++) {
    keys.push([(t += 1000), bottom], [(t += 1000), top], [(t += 500), top]);
  }
  return keys;
}

describe('createRepCounter: clean reps', () => {
  it('counts decreasing (squat) reps exactly once each', () => {
    const { events, last } = run(createRepCounter('decreasing', SQUAT), sample(reps(3, 175, 90)));
    expect(last.repCount).toBe(3);
    expect(ofType(events, 'rep_started').map((e) => e.attempt)).toEqual([1, 2, 3]);
    expect(ofType(events, 'rep_counted').map((e) => e.index)).toEqual([1, 2, 3]);
    expect(ofType(events, 'rep_closed').map((e) => e.timing.index)).toEqual([1, 2, 3]);
    expect(ofType(events, 'partial')).toHaveLength(0);
    expect(last.state).toBe('start');
  });

  it('counts increasing (shoulder press) reps exactly once each', () => {
    const { steps, events, last } = run(createRepCounter('increasing', SHOULDER_PRESS), sample(reps(3, 85, 170)));
    expect(last.repCount).toBe(3);
    expect(ofType(events, 'rep_counted').map((e) => e.index)).toEqual([1, 2, 3]);
    const closed = ofType(events, 'rep_closed');
    expect(closed).toHaveLength(3);
    for (const e of closed) {
      const values = steps.filter((s) => s.window?.attempt === e.attempt).map((s) => s.value as number);
      expect(e.timing.extreme).toBe(Math.max(...values));
      expect(e.timing.extreme).toBeGreaterThan(165);
    }
    expect(ofType(events, 'partial')).toHaveLength(0);
  });

  it('walks the states in order for the shoulder press', () => {
    const { steps } = run(createRepCounter('increasing', SHOULDER_PRESS), sample(reps(1, 85, 170)));
    const states = steps.map((s) => s.state).filter((s, i, all) => i === 0 || s !== all[i - 1]);
    expect(states).toEqual(['start', 'outbound', 'peak', 'return', 'start']);
  });
});

describe('createRepCounter: jitter', () => {
  it('ignores ±4° jitter hovering around start_enter while standing', () => {
    const frames = sample([[0, 165], [5000, 165]], { noise: 4, seed: 7 });
    const { events, last } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(events).toEqual([]);
    expect(last.state).toBe('start');
  });

  it('starts at most once when hovering around start_exit, and never partials or counts', () => {
    const frames = sample([[0, 175], [500, 175], [800, 160], [5000, 160]], { noise: 4, seed: 3 });
    const { events } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(types(events)).toEqual(['rep_started']);
  });

  it('enters peak once and counts once when hovering around count_min', () => {
    const frames = sample([[0, 175], [500, 175], [1300, 135], [3300, 135], [4300, 175], [5000, 175]], {
      noise: 4,
      seed: 11,
    });
    const { steps, events } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(ofType(events, 'rep_counted')).toHaveLength(1);
    expect(ofType(events, 'rep_started')).toHaveLength(1);
    expect(steps.filter((s, i) => s.state === 'peak' && steps[i - 1].state === 'outbound')).toHaveLength(1);
  });

  it('counts once when hovering around start_enter on the way up', () => {
    const frames = sample([[0, 175], [500, 175], [1500, 100], [2300, 165], [4300, 165], [4800, 175], [5500, 175]], {
      noise: 4,
      seed: 5,
    });
    const { events, last } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(ofType(events, 'rep_counted')).toHaveLength(1);
    expect(ofType(events, 'rep_started')).toHaveLength(1);
    expect(last.repCount).toBe(1);
  });

  it('counts every rep exactly once with ±4° noise throughout', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { events, last } = run(
        createRepCounter('decreasing', SQUAT),
        sample(reps(5, 175, 90), { noise: 4, seed }),
      );
      expect(last.repCount).toBe(5);
      expect(ofType(events, 'rep_started')).toHaveLength(5);
      expect(ofType(events, 'partial')).toHaveLength(0);
      expect(ofType(events, 'rep_closed')).toHaveLength(5);
    }
  });
});

describe('createRepCounter: bottom and partials', () => {
  it('counts a bounce at the bottom once and keeps the deepest extreme', () => {
    const frames = seq(0, 50, [175, 175, 175, 175, 155, 140, 120, 100, 100, 100, 103, 103, 98, 92, 92, 92, 100, 120, 150, 170, 175, 175, 175, 175]);
    const { events, steps } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(types(events)).toEqual(['rep_started', 'rep_counted', 'rep_closed']);
    const closed = ofType(events, 'rep_closed')[0];
    expect(closed.timing.extreme).toBe(92);
    expect(steps.find((s) => s.t === 550)?.state).toBe('peak'); // back 3° from 100 stays in peak
    expect(closed.timing.returnAt).toBe(800); // 100 is 8° back from 92
  });

  it('emits partial for an attempt that turns back before count_min, and numbers attempts on', () => {
    const keys: Key[] = [[0, 175], [500, 175], [1000, 145], [1500, 175], [2000, 175], [3000, 90], [4000, 175], [4500, 175]];
    const { events, last } = run(createRepCounter('decreasing', SQUAT), sample(keys));
    expect(types(events)).toEqual(['rep_started', 'partial', 'rep_started', 'rep_counted', 'rep_closed']);
    expect(events.map((e) => ('attempt' in e ? e.attempt : null))).toEqual([1, 1, 2, 2, 2]);
    expect(ofType(events, 'rep_counted')[0].index).toBe(1);
    expect(last.repCount).toBe(1);
  });
});

describe('createRepCounter: min_state_ms gating', () => {
  it('waits for active time in start and does not queue a transition', () => {
    const frames = seq(0, 50, [150, 150, 175, 175, 155, 120, 150, 150, 130]);
    const { steps } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(steps.map((s) => s.state)).toEqual([
      'start', // t=0, 0 ms in start
      'start', // t=50, past start_exit but only 50 ms
      'start',
      'start', // t=150, 150 ms but back above start_exit: nothing queued
      'outbound', // t=200
      'outbound', // t=250, spike past count_min after 50 ms in outbound
      'outbound',
      'outbound', // t=350, 150 ms but not past count_min
      'peak', // t=400
    ]);
    expect(steps[4].events).toEqual([{ type: 'rep_started', t: 200, attempt: 1 }]);
  });

  it('ignores a spike back past start_enter early in outbound', () => {
    const frames = seq(0, 50, [175, 175, 175, 175, 155, 170, 150, 140, 130]);
    const { events, last } = run(createRepCounter('decreasing', SQUAT), frames);
    expect(types(events)).toEqual(['rep_started']);
    expect(last.state).toBe('peak');
  });
});

describe('createRepCounter: null frames and set end', () => {
  const peakWithGap = seq(0, 50, [175, 175, 175, 175, 155, 140, 135.5, 130, 128])
    .concat(seq(450, 50, Array(10).fill(null)))
    .concat(seq(950, 50, [140, 145, 150, 160, 166, 170]));

  it('freezes state across null frames and pauses stateMs', () => {
    const { steps, events } = run(createRepCounter('decreasing', SQUAT), peakWithGap);
    for (const s of steps.filter((x) => x.value === null)) {
      expect(s.state).toBe('peak');
      expect(s.window).toBeNull();
      expect(s.events).toEqual([]);
    }
    expect(steps.find((s) => s.t === 950)?.state).toBe('peak');
    expect(steps.find((s) => s.t === 1000)?.state).toBe('peak');
    expect(steps.find((s) => s.t === 1050)?.state).toBe('return');
    expect(steps.find((s) => s.t === 1150)?.state).toBe('return'); // 100 ms in return
    expect(ofType(events, 'rep_counted')[0].t).toBe(1200);
  });

  it('reports timing with null gaps included in durations', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, peakWithGap);
    const { events } = run(counter, seq(1250, 50, [170, 170, 170]));
    const timing = ofType(events, 'rep_closed')[0].timing;
    expect(timing).toEqual({
      index: 1,
      startedAt: 200,
      peakAt: 350,
      returnAt: 1050,
      countedAt: 1200,
      closedAt: 1350,
      extreme: 128,
      durations: { outbound: 150, peak: 700, return: 150, rep: 1000 },
    });
  });

  it('ends the set as absent after set_end_still_ms of nulls once a rep is counted', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, sample(reps(1, 175, 90)));
    const { steps } = run(counter, seq(3000, 500, Array(20).fill(null)));
    const ending = steps.filter((s) => s.events.length > 0);
    expect(ending).toHaveLength(1);
    expect(ending[0].t).toBe(11000);
    expect(ending[0].events).toEqual([{ type: 'set_ended', t: 11000, reason: 'absent' }]);
    expect(ending[0].ended).toBe(true);
  });

  it('emits partial for an attempt in progress on absent end', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, sample([[0, 175], [500, 175], [1500, 90], [2500, 175], [3000, 175], [3500, 140]]));
    const { events } = run(counter, seq(3550, 1000, Array(10).fill(null)));
    expect(events).toEqual([
      { type: 'partial', t: 11550, attempt: 2 },
      { type: 'set_ended', t: 11550, reason: 'absent' },
    ]);
  });

  it('never ends the set before the first counted rep', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    const absent = run(counter, seq(0, 500, Array(30).fill(null)));
    const still = run(counter, sample([[15000, 175], [40000, 175]]));
    expect(absent.events).toEqual([]);
    expect(still.events).toEqual([]);
    expect(still.last.ended).toBe(false);
  });

  it('ends the set as still after set_end_still_ms in start, tail closed first', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    const first = run(counter, sample(reps(1, 175, 90)));
    const countedAt = ofType(first.events, 'rep_counted')[0].t;
    expect(ofType(first.events, 'rep_closed')).toHaveLength(1);
    // The still anchor settles by the time the angle reaches the top (175 at t=2500).
    const { steps } = run(counter, seq(3050, 50, Array(200).fill(175)));
    const ending = steps.find((s) => s.events.length > 0)!;
    expect(ending.events).toEqual([{ type: 'set_ended', t: ending.t, reason: 'still' }]);
    expect(ending.t).toBeGreaterThanOrEqual(countedAt + 8000);
    expect(ending.t).toBeLessThanOrEqual(2500 + 8000);
  });

  it('emits partial then set_ended on a manual end mid-rep, then ignores input', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, sample([[0, 175], [500, 175], [1300, 120]]));
    expect(counter.end(1400, 'manual')).toEqual({
      state: 'start',
      repCount: 0,
      ended: true,
      window: null,
      events: [
        { type: 'partial', t: 1400, attempt: 1 },
        { type: 'set_ended', t: 1400, reason: 'manual' },
      ],
    });
    const after = run(counter, sample(reps(2, 175, 90, 2000)));
    expect(after.events).toEqual([]);
    expect(after.steps.every((s) => s.window === null && s.ended && s.repCount === 0)).toBe(true);
    expect(counter.end(9000, 'manual').events).toEqual([]);
  });

  it('closes the tail on a manual end right after the count', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, seq(0, 50, [175, 175, 175, 175, 155, 140, 130, 120, 110, 115, 120, 140, 160, 166]));
    const step = counter.end(700, 'manual');
    expect(types(step.events)).toEqual(['rep_closed', 'set_ended']);
    expect(ofType(step.events, 'rep_closed')[0].timing.closedAt).toBe(700);
  });

  it('starts fresh after reset', () => {
    const counter = createRepCounter('decreasing', SQUAT);
    run(counter, sample(reps(2, 175, 90)));
    counter.end(6000, 'manual');
    counter.reset();
    const { events, last } = run(counter, sample(reps(1, 175, 90)));
    expect(last.ended).toBe(false);
    expect(last.repCount).toBe(1);
    expect(ofType(events, 'rep_started')[0].attempt).toBe(1);
  });
});

describe('createRepCounter: settle tail and windows', () => {
  // Push-up: counted at 157 (start_enter 155), the elbow keeps extending to 168.
  const toCount = seq(0, 50, [165, 165, 165, 165, 145, 130, 115, 110, 105, 100, 110, 125, 140, 153, 157]);
  const rising = seq(750, 50, [160, 163, 166, 168]);

  const returnFrames = (steps: Run['steps'], attempt: number) =>
    steps.filter((s) => s.window?.attempt === attempt && s.window.phase === 'return');

  it('tags windows by phase, with the start and count frames inside the rep', () => {
    const { steps } = run(createRepCounter('decreasing', PUSH_UP), toCount);
    expect(steps.slice(0, 4).every((s) => s.window === null)).toBe(true);
    expect(steps[4].window).toEqual({ attempt: 1, phase: 'outbound' });
    expect(steps.find((s) => s.t === 350)?.window).toEqual({ attempt: 1, phase: 'peak' });
    expect(steps.find((s) => s.t === 500)?.window).toEqual({ attempt: 1, phase: 'return' });
    const counted = steps[steps.length - 1];
    expect(counted.events).toEqual([{ type: 'rep_counted', t: 700, attempt: 1, index: 1 }]);
    expect(counted.state).toBe('start');
    expect(counted.window).toEqual({ attempt: 1, phase: 'return' });
  });

  it('keeps the return window open to the top and closes on hold, including the closing frame', () => {
    const { steps, events } = run(
      createRepCounter('decreasing', PUSH_UP),
      [...toCount, ...rising, ...seq(950, 50, [168, 168, 168, 168])],
    );
    expect(steps.find((s) => s.t === 1100)?.window).toBeNull();
    const closed = ofType(events, 'rep_closed');
    expect(closed).toHaveLength(1);
    // The top (168) is reached at 900; the hold runs min_state_ms from there.
    expect(closed[0].t).toBe(1050);
    const ret = returnFrames(steps, 1);
    expect(ret.map((s) => s.t)).toEqual([500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050]);
    expect(Math.max(...ret.map((s) => s.value as number))).toBe(168);
    expect(closed[0].timing).toMatchObject({
      countedAt: 700,
      closedAt: 1050,
      extreme: 100,
      durations: { outbound: 150, peak: 150, return: 200, rep: 500 },
    });
  });

  it('closes on moving back by reverse_deg and leaves that frame out', () => {
    const { steps, events } = run(
      createRepCounter('decreasing', PUSH_UP),
      [...toCount, ...rising, ...seq(950, 50, [163, 160])],
    );
    const closedStep = steps.find((s) => s.t === 950)!;
    expect(closedStep.events).toEqual([expect.objectContaining({ type: 'rep_closed', t: 950, attempt: 1 })]);
    expect(closedStep.window).toBeNull();
    expect(returnFrames(steps, 1).map((s) => s.t).pop()).toBe(900);
    expect(ofType(events, 'rep_closed')).toHaveLength(1);
  });

  it('closes the tail before the next rep starts in the same frame', () => {
    const { steps } = run(
      createRepCounter('decreasing', PUSH_UP),
      [...toCount, ...seq(750, 50, [157, 157, 149, 140])],
    );
    const frame = steps.find((s) => s.t === 850)!;
    expect(types(frame.events)).toEqual(['rep_closed', 'rep_started']);
    expect(frame.events[0]).toMatchObject({ attempt: 1, timing: { closedAt: 850 } });
    expect(frame.events[1]).toMatchObject({ attempt: 2 });
    expect(frame.window).toEqual({ attempt: 2, phase: 'outbound' });
    expect(returnFrames(steps, 1).map((s) => s.t).pop()).toBe(800);
  });

  it('does not advance the tail hold across null frames', () => {
    const { steps, events } = run(
      createRepCounter('decreasing', PUSH_UP),
      [...toCount, ...seq(750, 50, [158, null, null, null, null, 158, 158, 158, 158])],
    );
    expect(ofType(events, 'rep_closed')[0].t).toBe(1150);
    expect(steps.filter((s) => s.value === null).every((s) => s.window === null)).toBe(true);
    expect(returnFrames(steps, 1).map((s) => s.t).slice(-5)).toEqual([750, 1000, 1050, 1100, 1150]);
  });

  it('keeps a slow lockout in the window until it stops rising', () => {
    // 1° per 50 ms (20°/s) is slower than reverse_deg per min_state_ms.
    const slow = seq(750, 50, [158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 168, 168, 168, 168]);
    const { steps, events } = run(createRepCounter('decreasing', PUSH_UP), [...toCount, ...slow]);
    const ret = returnFrames(steps, 1);
    expect(Math.max(...ret.map((s) => s.value as number))).toBe(168);
    expect(ofType(events, 'rep_closed')[0].t).toBe(1400);
  });
});
