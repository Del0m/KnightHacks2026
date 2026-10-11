import { loadFixtures } from '../__fixtures__/load';
import { runClip } from '../__fixtures__/run';
import { MAX_PRIMARY_DEG_PER_S, createFormEngine, type FormEngine } from '../engine';
import { getSpec } from '../specs';
import { evaluateRep, phaseDuration } from '../rules';
import { form, generateClip, hold, move } from '../__fixtures__/synth';
import { isAbsentFrame, type Clip } from '../recording';
import type { ExerciseSpec, PrimaryGate } from '../types';
import { JOINT_NAMES, type Joint, type PoseResult } from '../../pose/types';

const clips: Clip[] = loadFixtures();
const named = (name: string) => {
  const clip = clips.find((c) => c.name === name);
  if (!clip) throw new Error(`missing fixture ${name}`);
  return clip;
};

describe('engine on joint sequences', () => {
  it('has a clip for every exercise', () => {
    const exercises = new Set(clips.map((c) => c.exercise));
    for (const id of ['squat', 'push_up', 'bicep_curl', 'shoulder_press', 'lunge']) expect(exercises).toContain(id);
  });

  describe.each(clips.filter((c) => c.expected).map((c) => [c.name, c] as const))('%s', (_name, clip) => {
    const run = runClip(clip);
    const expected = clip.expected!;

    it('counts every rep exactly once', () => {
      expect(run.counted).toEqual(Array.from({ length: expected.reps }, (_, i) => i + 1));
      expect(run.updates.at(-1)!.repCount).toBe(expected.reps);
    });

    it('reports partials', () => {
      expect(run.partials).toBe(expected.partials);
    });

    it('ends the set as expected', () => {
      expect(run.setEnd?.reason ?? null).toBe(expected.set_end);
    });

    it('closes every counted rep once, with consistent windows and durations', () => {
      const closedBeforeEnd = run.setEnd ? expected.reps : run.reps.length;
      expect(run.reps.map((r) => r.index)).toEqual(Array.from({ length: closedBeforeEnd }, (_, i) => i + 1));
      const primary = getSpec(clip.exercise)!.primary_angle.name;
      for (const rep of run.reps) {
        const { outbound, peak, return: ret, rep: all } = rep.windows;
        expect(outbound.length).toBeGreaterThan(0);
        expect(peak.length).toBeGreaterThan(0);
        expect(ret.length).toBeGreaterThan(0);
        expect(all).toEqual([...outbound, ...peak, ...ret]);
        for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThan(all[i - 1].t);
        for (const f of all) expect(f.metrics[primary]).not.toBeNull();
        expect(rep.startedAt).toBeLessThan(rep.peakAt);
        expect(rep.peakAt).toBeLessThan(rep.returnAt);
        expect(rep.returnAt).toBeLessThan(rep.countedAt);
        expect(rep.countedAt).toBeLessThanOrEqual(rep.closedAt);
        expect(rep.durations.rep).toBe(rep.countedAt - rep.startedAt);
        expect(rep.durations.return).toBe(rep.countedAt - rep.returnAt);
        expect(rep.side).not.toBeNull();
      }
    });
  });

  it('keeps the push-up lockout in the return window past the count', () => {
    const run = runClip(named('push_up_lockout'));
    const spec = getSpec('push_up')!;
    expect(run.reps.length).toBeGreaterThan(0);
    for (const rep of run.reps) {
      const top = Math.max(...rep.windows.return.map((f) => f.metrics.elbow!));
      expect(top).toBeGreaterThan(spec.phases.start_enter + 8);
      expect(rep.windows.return.at(-1)!.t).toBeGreaterThan(rep.countedAt);
    }
  });

  it('runs the shoulder press upward', () => {
    const run = runClip(named('shoulder_press_clean'));
    const spec = getSpec('shoulder_press')!;
    for (const rep of run.reps) expect(rep.extreme).toBeGreaterThan(spec.phases.count_min);
  });

  it('reads alternating lunges from either leg', () => {
    const run = runClip(named('lunge_alternating'));
    expect(new Set(run.reps.map((r) => r.side))).toEqual(new Set(['left', 'right']));
  });

  it('does not count noisy clips without smoothing more often than the expected reps', () => {
    // The state machine alone must not double count; smoothing only makes it cleaner.
    const clip = named('squat_noisy');
    const run = runClip(clip, { filter: { minCutoff: 1000, beta: 0 } });
    expect(run.counted.length).toBeLessThanOrEqual(clip.expected!.reps);
  });
});

describe('createFormEngine', () => {
  const squat = getSpec('squat')!;

  it('ends a set by hand mid-rep as a partial', () => {
    const clip = named('squat_clean');
    const engine = createFormEngine(squat, { imageAspect: clip.image.width / clip.image.height });
    let last;
    for (const f of clip.frames) {
      last = engine.push(f as PoseResult);
      if (last.state === 'peak') break;
    }
    const end = engine.endSet(last!.t + 10);
    expect(end.events.map((e) => e.type)).toEqual(['partial', 'set_ended']);
    expect(end.ended).toBe(true);
    expect(engine.push(clip.frames[clip.frames.length - 1] as PoseResult).events).toEqual([]);
  });

  it('starts over after reset', () => {
    const clip = named('squat_clean');
    const a = runClip(clip);
    const engine = createFormEngine(squat, { imageAspect: clip.image.width / clip.image.height });
    for (const f of clip.frames) engine.push(f as PoseResult);
    engine.reset();
    const counts = clip.frames.map((f) => engine.push(f as PoseResult).repCount);
    expect(counts.at(-1)).toBe(a.counted.length);
  });

  it('freezes on no-person frames', () => {
    const engine = createFormEngine(squat);
    const u = engine.pushAbsent(1000);
    expect(u).toMatchObject({ state: 'start', repCount: 0, primary: null, joints: null, events: [] });
  });

  /** Plays the clip's frames in `[from, upTo)` ms; returns the reps closed. */
  const play = (engine: FormEngine, clip: Clip, from = 0, upTo = Infinity) =>
    clip.frames
      .filter((f) => f.timestamp_ms >= from && f.timestamp_ms < upTo)
      .flatMap((f) => (isAbsentFrame(f) ? engine.pushAbsent(f.timestamp_ms) : engine.push(f)).events)
      .flatMap((e) => (e.type === 'rep_closed' ? [e.rep] : []));

  it('stamps each rep with the upright aspect it closed under', () => {
    const clip = named('squat_clean');
    const byDefault = play(createFormEngine(squat), clip);
    expect(byDefault.length).toBe(clip.expected!.reps);
    for (const r of byDefault) expect(r.imageAspect).toBe(9 / 16);

    const fromOption = play(createFormEngine(squat, { imageAspect: 0.56 }), clip);
    expect(fromOption.length).toBe(clip.expected!.reps);
    for (const r of fromOption) expect(r.imageAspect).toBe(0.56);

    const engine = createFormEngine(squat, { imageAspect: 0.56 });
    const first = play(engine, clip, 0, byDefault[1].closedAt + 1);
    engine.setImageAspect(0.57);
    const middle = play(engine, clip, byDefault[1].closedAt + 1, byDefault[3].closedAt + 1);
    engine.setImageAspect(undefined);
    const rest = play(engine, clip, byDefault[3].closedAt + 1);
    expect([...first, ...middle, ...rest].map((r) => r.imageAspect)).toEqual([0.56, 0.56, 0.57, 0.57, 9 / 16, 9 / 16]);
  });

  it('ends the set as lost when the person stays but the primary angle cannot be measured', () => {
    const clip = named('squat_clean');
    const firstRep = play(createFormEngine(squat), clip)[0];
    const engine = createFormEngine(squat);
    play(engine, clip, 0, firstRep.closedAt + 1);
    // The detector still finds a person, but no joint is confident enough to measure.
    const pose = clip.frames.find((f): f is PoseResult => !isAbsentFrame(f))!;
    const blind = pose.joints.map((j) => ({ ...j, c: 0 }));
    const ends = [];
    for (let t = firstRep.closedAt + 100; t <= firstRep.closedAt + 9000; t += 100) {
      ends.push(...engine.push({ ...pose, timestamp_ms: t, joints: blind }).events.filter((e) => e.type === 'set_ended'));
    }
    expect(ends).toEqual([expect.objectContaining({ type: 'set_ended', reason: 'lost' })]);
  });
});

describe('createFormEngine: counting only real movement', () => {
  const ASPECT = 9 / 16;
  /** Shoulder press phases, with `elbow` (left) as the primary and `knee` (left) free to gate it. */
  const pressSpec = (gate?: PrimaryGate): ExerciseSpec => {
    const press = getSpec('shoulder_press')!;
    return {
      ...press,
      angles: {
        ...press.angles,
        elbow: { type: 'joint_angle', joints: ['shoulder', 'elbow', 'wrist'], side: 'left' },
        knee: { type: 'joint_angle', joints: ['hip', 'knee', 'ankle'], side: 'left' },
      },
      primary_angle: { name: 'elbow', direction: 'increasing', ...(gate ? { gate } : {}) },
    };
  };
  /** A joint `angle` degrees at `vertex`, the first segment pointing up. */
  const limb = (names: [string, string, string], x: number, angle: number, c: number): Record<string, Joint> => {
    const rad = (angle * Math.PI) / 180;
    return {
      [names[0]]: { x, y: 0.3, c },
      [names[1]]: { x, y: 0.5, c },
      [names[2]]: { x: x + (0.1 * Math.sin(rad)) / ASPECT, y: 0.5 - 0.1 * Math.cos(rad), c },
    };
  };
  interface PoseOpts {
    /** Knee angle, or null for no leg. Default 90. */
    knee?: number | null;
    /** Left wrist confidence. Default 0.9. */
    wristC?: number;
  }
  const pose = (t: number, elbow: number, { knee = 90, wristC = 0.9 }: PoseOpts = {}): PoseResult => {
    const named: Record<string, Joint> = {
      ...limb(['left_shoulder', 'left_elbow', 'left_wrist'], 0.4, elbow, 0.9),
      ...(knee === null ? {} : limb(['left_hip', 'left_knee', 'left_ankle'], 0.6, knee, 0.9)),
    };
    named.left_wrist = { ...named.left_wrist, c: wristC };
    const joints = JOINT_NAMES.map((name) => named[name] ?? { x: 0, y: 0, c: 0 });
    return { source: 'coreml', model: 'test', timestamp_ms: t, score: 0.9, joints };
  };
  /** Linear keyframes `[t, elbow]` sampled every 33 ms. */
  const elbowAt = (keys: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (let t = keys[0][0]; t <= keys[keys.length - 1][0]; t += 33) {
      const k = keys.findIndex(([kt], i) => i < keys.length - 1 && t <= keys[i + 1][0]);
      const [ta, va] = keys[k];
      const [tb, vb] = keys[k + 1];
      out.push([t, va + ((vb - va) * (t - ta)) / (tb - ta)]);
    }
    return out;
  };
  /** One press: rest at 80, up to 160 in `upMs`, hold, back down in `upMs`, rest. */
  const pressRep = (upMs = 1000): [number, number][] =>
    elbowAt([[0, 80], [500, 80], [500 + upMs, 160], [800 + upMs, 160], [800 + 2 * upMs, 80], [1300 + 2 * upMs, 80]]);
  /** Near pass-through smoothing, so the angle the engine sees is the one drawn. */
  const raw = { filter: { minCutoff: 1000, beta: 0 } };
  const play = (engine: FormEngine, poses: PoseResult[]) => {
    const updates = poses.map((p) => engine.push(p));
    const events = updates.flatMap((u) => u.events);
    return {
      updates,
      events,
      counted: events.filter((e) => e.type === 'rep_counted').length,
      partials: events.filter((e) => e.type === 'partial').length,
      reps: events.flatMap((e) => (e.type === 'rep_closed' ? [e.rep] : [])),
    };
  };

  describe('primary gate', () => {
    const gate: PrimaryGate = { metric: 'knee', op: '<=', value: 100 };

    it('does not borrow range reached before the gate passed', () => {
      const frames = [
        [0, 80, 170], [200, 110, 170], [400, 160, 170],
        [600, 120, 90], [800, 110, 90], [1000, 90, 170],
      ];
      const r = play(createFormEngine(pressSpec(gate), raw), frames.map(([t, elbow, knee]) => pose(t, elbow, { knee })));
      expect([r.counted, r.partials]).toEqual([0, 1]);
      expect(r.updates.some((u) => u.state === 'peak')).toBe(false);
    });

    it('counts when the gate passes', () => {
      const r = play(createFormEngine(pressSpec(gate), raw), pressRep().map(([t, v]) => pose(t, v, { knee: 90 })));
      expect([r.counted, r.partials]).toEqual([1, 0]);
    });

    it('blocks peak when the gate fails, and the attempt becomes a partial', () => {
      const r = play(createFormEngine(pressSpec(gate), raw), pressRep().map(([t, v]) => pose(t, v, { knee: 170 })));
      expect([r.counted, r.partials]).toEqual([0, 1]);
      expect(r.updates.some((u) => u.state === 'peak')).toBe(false);
    });

    it('blocks peak when the gate metric is null', () => {
      const r = play(createFormEngine(pressSpec(gate), raw), pressRep().map(([t, v]) => pose(t, v, { knee: null })));
      expect(r.updates.every((u) => u.metrics.knee === null)).toBe(true);
      expect([r.counted, r.partials]).toEqual([0, 1]);
    });
  });

  it('evaluates squat depth at a turn before the outbound dwell expires', () => {
    const spec = getSpec('squat')!;
    const frames = [
      [0, 170], [200, 155], [267, 120], [334, 90], [401, 115],
      [468, 140], [535, 155], [602, 170], [802, 170], [1002, 170],
    ];
    const r = play(createFormEngine(spec, raw), frames.map(([t, knee]) => pose(t, 80, { knee })));
    expect(r.reps).toHaveLength(1);
    const rep = r.reps[0];
    expect(rep.extreme).toBeLessThan(spec.phases.target);
    expect(Math.min(...rep.windows.peak.map((f) => f.metrics.knee!))).toBeGreaterThan(spec.phases.target);
    const result = evaluateRep(spec, rep, { view: 'side' });
    expect(result.outcomes.find((o) => o.rule_id === 'depth')).toMatchObject({ status: 'pass', value: rep.extreme });
    expect(result.flags.map((f) => f.rule_id)).not.toContain('depth');
    expect(result.flags.map((f) => f.rule_id)).toContain('tempo');
  });

  it('does not borrow an arms-down extreme for a short overhead press or its tempo', () => {
    const spec = getSpec('shoulder_press')!;
    const clip = generateClip({
      name: 'press_after_arms_down', exercise: 'shoulder_press', description: 'lap, straight arms down, short press',
      seed: 1, fps: 15, jitterMs: 0, noise: 0, spikes: 0, dips: 0, view: 'front', facing: 1,
      farConfidence: [0.9, 0.9], source: 'coreml', startAngle: 85, absentWindows: [], offsetY: 0,
      script: [
        form({ forearm: 'down' }), hold(500), move(131, 800, 10), hold(200),
        move(170, 800, 8), hold(200), move(131, 800, 10), hold(200),
        form({ forearm: 'up' }), move(140, 1000, 140), hold(300), move(85, 800, 85), hold(500),
      ],
      expected: { reps: 1, partials: 0, set_end: null },
    }, { clean: true });
    const run = runClip(clip, raw);
    expect(run.counted).toEqual([1]);
    const rep = run.reps[0];
    expect(Math.max(...rep.windows.rep.filter((f) => f.metrics.arm_raise! > 60).map((f) => f.metrics.elbow!))).toBeGreaterThan(165);
    expect(rep.extreme).toBeCloseTo(140, 0);
    expect(evaluateRep(spec, rep, { view: 'front' }).outcomes.find((o) => o.rule_id === 'lockout')).toMatchObject({ status: 'flag', threshold: 150 });
    expect(phaseDuration(spec, rep, 'return')).toBeGreaterThan(500);
    expect(phaseDuration(spec, rep, 'return')).toBeLessThan(1000);
  });

  describe('primary confidence', () => {
    it('is null while the wrist is held at low confidence, other metrics unaffected', () => {
      const engine = createFormEngine(pressSpec(), raw);
      engine.push(pose(0, 80));
      const held = engine.push(pose(33, 80, { wristC: 0.1 }));
      expect(held.primary).toBeNull();
      expect(held.metrics.elbow).toBeNull();
      expect(held.metrics.knee).toBeCloseTo(90, 0);
      expect(engine.push(pose(66, 80)).primary).toBeCloseTo(80, 0);
    });
  });

  describe('jump rejection', () => {
    it('ignores a single spike, which stays out of the windows', () => {
      const frames = pressRep();
      const i = frames.findIndex(([, v]) => v >= 120);
      const spikeT = frames[i][0];
      frames[i] = [spikeT, 40];
      const r = play(createFormEngine(pressSpec(), raw), frames.map(([t, v]) => pose(t, v)));
      const spike = r.updates[i];
      expect(spike.primary).toBeNull();
      expect(spike.metrics.elbow).toBeCloseTo(40, 0);
      expect(r.updates[i + 1].primary).not.toBeNull();
      expect([r.counted, r.partials]).toEqual([1, 0]);
      expect(r.reps[0].windows.rep.map((f) => f.t)).not.toContain(spikeT);
    });

    it('accepts the next value after 3 rejections in a row', () => {
      const engine = createFormEngine(pressSpec(), raw);
      engine.push(pose(0, 80));
      const primaries = [33, 66, 99, 132, 165].map((t) => engine.push(pose(t, 160)).primary);
      expect(primaries.slice(0, 3)).toEqual([null, null, null]);
      expect(primaries[3]).toBeCloseTo(160, 0);
      expect(primaries[4]).toBeCloseTo(160, 0);
    });

    it('has no reference after a null frame', () => {
      const engine = createFormEngine(pressSpec(), raw);
      engine.push(pose(0, 80));
      expect(engine.push(pose(33, 80, { wristC: 0.1 })).primary).toBeNull();
      expect(engine.push(pose(66, 160)).primary).toBeGreaterThan(150);
    });

    it('starts over on reset', () => {
      const engine = createFormEngine(pressSpec(), raw);
      engine.push(pose(0, 80));
      engine.reset();
      expect(engine.push(pose(33, 160)).primary).toBeCloseTo(160, 0);
    });

    it(`keeps a fast real rep (400°/s, under ${MAX_PRIMARY_DEG_PER_S}°/s)`, () => {
      const frames = pressRep(200);
      const r = play(createFormEngine(pressSpec(), raw), frames.map(([t, v]) => pose(t, v)));
      expect(r.updates.every((u) => u.primary !== null)).toBe(true);
      expect([r.counted, r.partials]).toEqual([1, 0]);
    });
  });
});
