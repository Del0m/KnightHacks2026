import { loadFixtures } from '../__fixtures__/load';
import { runClip } from '../__fixtures__/run';
import { createFormEngine } from '../engine';
import { getSpec } from '../specs';
import type { Clip } from '../recording';
import type { PoseResult } from '../../pose/types';

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
});
