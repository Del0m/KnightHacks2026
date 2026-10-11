import fs from 'fs';
import path from 'path';

import type { SetRecord } from '../../../../../specs/set-record/types';
import { JOINT_NAMES, type PoseResult } from '../../pose/types';
import { loadFixtures } from '../__fixtures__/load';
import { runClip } from '../__fixtures__/run';
import { createFormEngine } from '../engine';
import { compactPose, isAbsentFrame, type Clip } from '../recording';
import { createSetRules, phaseDuration, summarizeSet } from '../rules';
import { form, generateClip, hold, move } from '../__fixtures__/synth';
import { buildSetRecord, createSetRecorder, LEAD_IN_MS, MAX_SET_FRAMES, type SetRecordInput } from '../setRecord';
import { getSpec } from '../specs';
import type { EngineEvent, EngineFrame, RepRecord, RepResult, SetEndReason } from '../types';

const spec = getSpec('squat')!;
const poseAt = (timestamp_ms: number): PoseResult => ({
  source: 'coreml',
  model: 'test',
  timestamp_ms,
  score: 0.999,
  joints: JOINT_NAMES.map((_, index) => ({ x: 0.123456 + index / 100, y: 0.876543 - index / 100, c: 0.9876 })),
});

const frameAt = (t: number, value: number | null): EngineFrame => ({
  t,
  metrics: { [spec.primary_angle.name]: value },
  sides: {},
  joints: [],
});

function repWith(overrides: Partial<RepRecord> = {}): RepRecord {
  return {
    index: 1,
    startedAt: 1200,
    peakAt: 1500,
    returnAt: 1800,
    countedAt: 2200,
    closedAt: 2400,
    extreme: 70.04,
    durations: { outbound: 300, peak: 300, return: 400, rep: 1000 },
    side: 'left',
    imageAspect: 9 / 16,
    windows: {
      outbound: [],
      peak: [],
      return: [],
      rep: [frameAt(1200, 160), frameAt(1500, 70.04), frameAt(1800, 70.04), frameAt(2200, 165), frameAt(2350, 179.96)],
    },
    ...overrides,
  };
}

const resultAt = (rep_index: number, flagged = false): RepResult => ({
  rep_index,
  view: 'side',
  view_source: 'caller',
  flags: flagged ? [{ rep_index, rule_id: 'depth', severity: 'safety' }] : [],
  outcomes: [],
  tint_joints: [],
});

const flagsFor = (count: number, reason: SetEndReason = 'manual') =>
  summarizeSet(spec, Array.from({ length: count }, (_, index) => resultAt(index)), reason);

function inputWith(overrides: Partial<SetRecordInput> = {}): SetRecordInput {
  return {
    spec,
    setIndex: 2,
    weightKg: 12.5,
    poses: [poseAt(1000), poseAt(1100)],
    reps: [repWith()],
    flags: flagsFor(1),
    partials: 2,
    ...overrides,
  };
}

function expectIntegerRelations(record: SetRecord): void {
  for (const [position, rep] of record.reps.entries()) {
    expect(rep.rep_index).toBe(position);
    expect(rep.start_ms).not.toBeNull();
    expect(rep.end_ms! - rep.start_ms!).toBe(rep.tempo_ms);
    for (const value of [rep.start_ms, rep.end_ms, rep.tempo_ms, rep.lowering_ms, rep.rising_ms]) {
      if (value !== null) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    if (rep.lowering_ms === null) expect(rep.rising_ms).toBeNull();
    else expect(rep.lowering_ms + rep.rising_ms!).toBe(rep.tempo_ms);
    expect(rep.quality).toBeNull();
    for (const flag of rep.flags) expect(flag.rep_index).toBe(position);
  }
  if (record.frames.length) expect(record.frames[0].t_ms).toBe(0);
  let previous = -1;
  for (const frame of record.frames) {
    expect(Number.isInteger(frame.t_ms)).toBe(true);
    expect(frame.t_ms).toBeGreaterThanOrEqual(previous);
    expect(frame.kp).toHaveLength(51);
    expect(frame.kp.every(Number.isFinite)).toBe(true);
    previous = frame.t_ms;
  }
}

describe('buildSetRecord', () => {
  it('packages only contract fields, raw COCO joints, flags, range and start-to-turn timing', () => {
    const flags = summarizeSet(spec, [resultAt(0, true)], 'manual');
    const input = inputWith({ flags });
    const before = JSON.stringify(input);
    const record = buildSetRecord(input);
    expect(record).toEqual({
      schema_version: 1,
      set_index: 2,
      exercise_id: 'squat',
      weight_kg: 12.5,
      end_reason: 'manual',
      partial_reps: 2,
      fps: 10,
      frames: input.poses.map((pose, index) => ({
        t_ms: index * 100,
        kp: compactPose(pose).joints.flatMap((joint) => [joint.x, joint.y, joint.c]),
      })),
      reps: [{
        rep_index: 0, start_ms: 200, end_ms: 1200, tempo_ms: 1000, range_deg: 95,
        quality: null, lowering_ms: 300, rising_ms: 700,
        flags: [{ rule_id: 'depth', severity: 'safety', rep_index: 0 }],
      }],
    });
    expect(JSON.stringify(input)).toBe(before);
    record.frames[0].kp[0] = 99;
    record.reps[0].flags[0].rule_id = 'changed';
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rounds clock positions before subtracting durations, including fractional Unix timestamps', () => {
    const origin = 1_790_000_000_000.25;
    const startedAt = origin + 100.49;
    const countedAt = origin + 300.51;
    const rep = repWith({
      startedAt, countedAt, closedAt: countedAt + 300, extreme: 80,
      durations: { outbound: 0, peak: 0, return: 0, rep: countedAt - startedAt },
      windows: { outbound: [], peak: [], return: [], rep: [frameAt(startedAt, 160), frameAt(origin + 200.51, 80)] },
    });
    const record = buildSetRecord(inputWith({ poses: [poseAt(origin), poseAt(origin + 66.666)], reps: [rep] }));
    expect(record.frames.map((frame) => frame.t_ms)).toEqual([0, 67]);
    expect(record.fps).toBe(14.9);
    expect(record.reps[0]).toMatchObject({ start_ms: 100, end_ms: 301, tempo_ms: 201, lowering_ms: 101, rising_ms: 100 });
    expect(Math.round(rep.durations.rep)).toBe(200);
    expectIntegerRelations(record);
  });

  it('splits at the direction-aware turn and measures range only on gated frames up to the count', () => {
    const windows = { outbound: [], peak: [], return: [], rep: [
      frameAt(1200, 50), frameAt(1600, 170), frameAt(2200, 60), frameAt(2350, 20),
    ] };
    const increasing = { ...spec, primary_angle: { ...spec.primary_angle, direction: 'increasing' as const } };
    const pressing = buildSetRecord(inputWith({ spec: increasing, reps: [repWith({ extreme: 170, windows })] }));
    // The settle tail at 2350 (20°) is after the count, so it stays out of range.
    expect(pressing.reps[0]).toMatchObject({ lowering_ms: 400, rising_ms: 600, range_deg: 120 });
    const lowering = buildSetRecord(inputWith({ reps: [repWith({ extreme: 50, windows })] }));
    expect(lowering.reps[0]).toMatchObject({ lowering_ms: 0, rising_ms: 1000, range_deg: 120 });
  });

  it.each([
    ['empty', [], 0],
    ['null metric', [frameAt(1500, null)], 0],
    ['after the count only', [frameAt(2300, 20)], 0],
  ] as const)('falls back to the engine phase durations with %s windows', (_label, frames, range) => {
    const rep = repWith({ windows: { outbound: [], peak: [], return: [], rep: [...frames] } });
    expect(buildSetRecord(inputWith({ reps: [rep] })).reps[0]).toMatchObject({
      lowering_ms: 300, rising_ms: 700, range_deg: range,
    });
  });

  it('ignores gate-failing frames for range and the turn', () => {
    const press = getSpec('shoulder_press')!;
    const gated = (t: number, elbow: number, arm_raise: number): EngineFrame => ({
      t, metrics: { elbow, arm_raise }, sides: {}, joints: [],
    });
    const rep = repWith({
      extreme: 140,
      windows: { outbound: [], peak: [], return: [], rep: [
        gated(1200, 85, 30), gated(1400, 170, 80), gated(1700, 140, 30), gated(2200, 90, 30),
      ] },
    });
    const flags = summarizeSet(press, [resultAt(0)], 'manual');
    expect(buildSetRecord(inputWith({ spec: press, reps: [rep], flags })).reps[0]).toMatchObject({
      lowering_ms: 500, rising_ms: 500, range_deg: 55,
    });
  });

  it('falls back to the first rep clock without poses, and supports empty and single-frame sets', () => {
    const noPoses = buildSetRecord(inputWith({ poses: [] }));
    expect(noPoses.fps).toBeNull();
    expect(noPoses.reps[0]).toMatchObject({ start_ms: 0, end_ms: 1000 });
    const empty = buildSetRecord(inputWith({ poses: [], reps: [], flags: flagsFor(0), weightKg: null }));
    expect(empty).toMatchObject({ frames: [], reps: [], fps: null, weight_kg: null });
    expect(buildSetRecord(inputWith({ poses: [poseAt(1000)] })).fps).toBeNull();
  });

  it('normalizes rounded negative zero without clamping finite raw coordinates', () => {
    const pose = poseAt(1000);
    pose.joints[0] = { x: -0.000001, y: 1.234567, c: 0.001 };
    expect(buildSetRecord(inputWith({ poses: [pose] })).frames[0].kp.slice(0, 3)).toEqual([0, 1.2346, 0]);
  });

  it.each([
    ['total count', (input: SetRecordInput) => { input.flags.total_reps = 0; }],
    ['missing result', (input: SetRecordInput) => { input.flags.reps = []; }],
    ['extra result', (input: SetRecordInput) => { input.flags.reps.push(resultAt(1)); }],
    ['wrong result index', (input: SetRecordInput) => { input.flags.reps[0].rep_index = 1; }],
    ['wrong flag index', (input: SetRecordInput) => { input.flags.reps[0].flags = [{ rule_id: 'depth', severity: 'form', rep_index: 1 }]; }],
    ['missing per-rep flag', (input: SetRecordInput) => { input.flags.flags = [{ rule_id: 'depth', severity: 'form', rep_index: 0 }]; }],
    ['exercise mismatch', (input: SetRecordInput) => { input.flags.exercise_id = 'push_up'; }],
    ['nonconsecutive rep', (input: SetRecordInput) => { input.reps[0].index = 2; }],
    ['duration mismatch', (input: SetRecordInput) => { input.reps[0].durations.rep = 500; }],
    ['nonfinite metric', (input: SetRecordInput) => { input.reps[0].windows.rep[0].metrics[spec.primary_angle.name] = NaN; }],
    ['unordered window', (input: SetRecordInput) => { input.reps[0].windows.rep.reverse(); }],
    ['range overflow', (input: SetRecordInput) => { input.reps[0].windows.rep[0].metrics[spec.primary_angle.name] = 300; }],
    ['rep before origin', (input: SetRecordInput) => { input.poses = [poseAt(2000)]; }],
    ['invalid set index', (input: SetRecordInput) => { input.setIndex = 201; }],
    ['invalid weight', (input: SetRecordInput) => { input.weightKg = NaN; }],
    ['invalid partial count', (input: SetRecordInput) => { input.partials = -1; }],
    ['frame overflow', (input: SetRecordInput) => { input.poses = Array.from({ length: MAX_SET_FRAMES + 1 }, (_, index) => poseAt(index * 100)); }],
    ['tempo overflow', (input: SetRecordInput) => {
      input.reps[0].countedAt = 122201;
      input.reps[0].closedAt = 122201;
      input.reps[0].durations.rep = 121001;
    }],
  ])('reports %s instead of emitting a misleading payload', (_label, mutate) => {
    const input = inputWith();
    mutate(input);
    expect(() => buildSetRecord(input)).toThrow('SetRecord:');
  });

  it('rejects duplicate or reordered flag results even when counts match', () => {
    const input = inputWith({ reps: [repWith(), repWith({ index: 2 })], flags: flagsFor(2) });
    input.flags.reps[1].rep_index = 0;
    expect(() => buildSetRecord(input)).toThrow('indices');
    input.flags = flagsFor(2);
    input.flags.reps.reverse();
    expect(() => buildSetRecord(input)).toThrow('indices');
  });

  it.each([[1000, 1000.1], [1000, 1001], [1000, 1_000_000]])('reports unrepresentable fps for %j', (first, last) => {
    expect(() => buildSetRecord(inputWith({ poses: [poseAt(first), poseAt(last)] }))).toThrow('fps');
  });
});

describe('createSetRecorder', () => {
  it('keeps the inclusive 1s lead-in, continues through partials and freezes at set_ended', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    for (const time of [0, 999, 1000, 1500, 2000]) recorder.pose(poseAt(time));
    recorder.event({ type: 'rep_started', t: 2000 });
    recorder.pose(poseAt(2200));
    recorder.event({ type: 'partial', t: 2200 });
    recorder.pose(poseAt(2500));
    recorder.event({ type: 'rep_started', t: 2500 });
    recorder.pose(poseAt(3000));
    recorder.event({ type: 'set_ended', t: 3000, reason: 'still' });
    recorder.pose(poseAt(3100));
    recorder.event({ type: 'partial', t: 3100 });
    const record = recorder.finish(flagsFor(0, 'still'));
    expect(LEAD_IN_MS).toBe(1000);
    expect(record.frames.map((frame) => frame.t_ms)).toEqual([0, 500, 1000, 1200, 1500, 2000]);
    expect(record).toMatchObject({ partial_reps: 1, end_reason: 'still', weight_kg: null, fps: 2.5 });
  });

  it('trims the lead-in against the first rep event even after an absent gap', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    for (const time of [0, 500, 1000]) recorder.pose(poseAt(time));
    recorder.event({ type: 'rep_started', t: 1800 });
    recorder.event({ type: 'set_ended', t: 2000, reason: 'manual' });
    expect(recorder.finish(flagsFor(0)).frames).toHaveLength(1);
  });

  it('bounds the rolling buffer before any first rep and never silently clamps excessive fps', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    for (let index = 0; index < MAX_SET_FRAMES * 2; index++) recorder.pose(poseAt(index / 100));
    recorder.event({ type: 'set_ended', t: 200, reason: 'manual' });
    expect(() => recorder.finish(flagsFor(0))).toThrow('fps');
    recorder.reset();
    for (let index = 0; index <= MAX_SET_FRAMES * 2; index++) recorder.pose(poseAt(index * 10));
    recorder.event({ type: 'set_ended', t: MAX_SET_FRAMES * 20, reason: 'manual' });
    const record = recorder.finish(flagsFor(0));
    expect(record.frames).toHaveLength(101);
    expect(record.frames.at(-1)!.t_ms).toBe(1000);
  });

  it('caps at 5400 without losing later closed reps or their windows-derived aggregates', () => {
    const recorder = createSetRecorder(spec, { setIndex: 2, weightKg: 0 });
    recorder.pose(poseAt(0));
    recorder.event({ type: 'rep_started', t: 0 });
    for (let index = 1; index < MAX_SET_FRAMES + 100; index++) recorder.pose(poseAt(index * 5));
    const startedAt = (MAX_SET_FRAMES + 100) * 5;
    const rep = repWith({
      startedAt, countedAt: startedAt + 1000, closedAt: startedAt + 1200, extreme: 80,
      windows: { outbound: [], peak: [], return: [], rep: [frameAt(startedAt, 160), frameAt(startedAt + 500, 80)] },
    });
    recorder.event({ type: 'rep_closed', t: rep.closedAt, rep });
    recorder.event({ type: 'set_ended', t: rep.closedAt, reason: 'manual' });
    const record = recorder.finish(flagsFor(1));
    expect(record.frames).toHaveLength(MAX_SET_FRAMES);
    expect(record.frames.at(-1)!.t_ms).toBe((MAX_SET_FRAMES - 1) * 5);
    expect(record.reps[0]).toMatchObject({ start_ms: startedAt, lowering_ms: 500, rising_ms: 500, range_deg: 80 });
    expect(record.weight_kg).toBe(0);
  });

  it('reduces windows at rep_closed and owns copies of raw poses', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    const pose = poseAt(1000);
    recorder.pose(pose);
    recorder.event({ type: 'rep_started', t: 1200 });
    const rep = repWith();
    recorder.event({ type: 'rep_closed', t: 2400, rep });
    pose.joints[0].x = 99;
    rep.windows.rep.length = 0;
    rep.startedAt = 99;
    Object.defineProperty(rep, 'windows', { get() { throw new Error('windows accessed after close'); } });
    recorder.event({ type: 'set_ended', t: 2500, reason: 'manual' });
    const record = recorder.finish(flagsFor(1));
    expect(record.frames[0].kp[0]).toBe(0.1235);
    expect(record.reps[0]).toMatchObject({ start_ms: 200, range_deg: 95, lowering_ms: 300 });
  });

  it('requires an end event, supports retry and repeated finish, and resets every clock and buffer', () => {
    const recorder = createSetRecorder(spec, { setIndex: 3 });
    recorder.pose(poseAt(1000));
    recorder.event({ type: 'rep_started', t: 1200 });
    recorder.event({ type: 'rep_closed', t: 2400, rep: repWith() });
    expect(() => recorder.finish(flagsFor(1))).toThrow('set_ended');
    recorder.event({ type: 'set_ended', t: 2500, reason: 'manual' });
    expect(() => recorder.finish(flagsFor(0))).toThrow('count');
    expect(() => recorder.finish(flagsFor(1, 'lost'))).toThrow('end reason');
    const record = recorder.finish(flagsFor(1));
    expect(recorder.finish(flagsFor(1))).toEqual(record);
    record.frames[0].kp[0] = 99;
    record.reps[0].start_ms = 99;
    expect(recorder.finish(flagsFor(1)).reps[0].start_ms).toBe(200);
    expect(recorder.finish(flagsFor(1)).frames[0].kp[0]).toBe(0.1235);
    recorder.reset();
    expect(() => recorder.finish(flagsFor(0))).toThrow('set_ended');
    recorder.pose(poseAt(0));
    recorder.event({ type: 'set_ended', t: 0, reason: 'absent' });
    expect(recorder.finish(flagsFor(0, 'absent'))).toMatchObject({ set_index: 3, reps: [], partial_reps: 0, fps: null });
  });

  it('reports the 201st rep instead of retaining unlimited windows or truncating reps', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    for (let index = 1; index <= 200; index++) {
      recorder.event({ type: 'rep_closed', t: 2400, rep: repWith({ index }) });
    }
    expect(() => recorder.event({ type: 'rep_closed', t: 2400, rep: repWith({ index: 201 }) })).toThrow('200 reps');
  });

  it('finishes a lost set with no poses using the first rep clock', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    expect(() => recorder.finish(flagsFor(0))).toThrow('set_ended');
    recorder.event({ type: 'rep_started', t: 1200 });
    recorder.event({ type: 'rep_closed', t: 2400, rep: repWith() });
    recorder.event({ type: 'partial', t: 2500 });
    recorder.event({ type: 'set_ended', t: 3000, reason: 'lost' });
    const record = recorder.finish(flagsFor(1, 'lost'));
    expect(record).toMatchObject({ frames: [], fps: null, partial_reps: 1, end_reason: 'lost' });
    expect(record.reps[0]).toMatchObject({ start_ms: 0, end_ms: 1000 });
  });

  it('rejects out-of-order and nonfinite event times', () => {
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    recorder.event({ type: 'rep_started', t: 1000 });
    for (const time of [999, NaN, Infinity]) {
      expect(() => recorder.event({ type: 'partial', t: time })).toThrow('event timestamps');
    }
  });
});

describe('malformed pose handling in both entry points', () => {
  it.each([
    ['NaN timestamp', (pose: PoseResult) => { pose.timestamp_ms = NaN; }],
    ['infinite timestamp', (pose: PoseResult) => { pose.timestamp_ms = Infinity; }],
    ['negative timestamp', (pose: PoseResult) => { pose.timestamp_ms = -1; }],
    ['missing joint', (pose: PoseResult) => { pose.joints.pop(); }],
    ['extra joint', (pose: PoseResult) => { pose.joints.push(pose.joints[0]); }],
    ['sparse joints', (pose: PoseResult) => { delete pose.joints[0]; }],
    ['NaN coordinate', (pose: PoseResult) => { pose.joints[0].x = NaN; }],
    ['infinite confidence', (pose: PoseResult) => { pose.joints[0].c = Infinity; }],
    ['rounding overflow', (pose: PoseResult) => { pose.joints[0].x = Number.MAX_VALUE; }],
  ])('%s is rejected without poisoning recorder state', (_label, mutate) => {
    const bad = poseAt(1000);
    mutate(bad);
    expect(() => buildSetRecord(inputWith({ poses: [bad] }))).toThrow('SetRecord:');
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    expect(() => recorder.pose(bad)).toThrow('SetRecord:');
    recorder.pose(poseAt(1000));
    recorder.event({ type: 'set_ended', t: 1000, reason: 'manual' });
    expect(recorder.finish(flagsFor(0)).frames).toHaveLength(1);
  });

  it.each([999, 1000])('rejects stale/duplicate pose time %s', (time) => {
    expect(() => buildSetRecord(inputWith({ poses: [poseAt(1000), poseAt(time)] }))).toThrow('strictly increase');
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    recorder.pose(poseAt(1000));
    expect(() => recorder.pose(poseAt(time))).toThrow('strictly increase');
    recorder.pose(poseAt(1100));
    recorder.event({ type: 'set_ended', t: 1100, reason: 'manual' });
    expect(recorder.finish(flagsFor(0)).frames.map((frame) => frame.t_ms)).toEqual([0, 100]);
  });
});

function recordClip(clip: Clip): { record: SetRecord; closed: RepRecord[] } {
  const exercise = getSpec(clip.exercise)!;
  const engine = createFormEngine(exercise, { imageAspect: clip.image.width / clip.image.height });
  const rules = createSetRules(exercise);
  const recorder = createSetRecorder(exercise, { setIndex: 0 });
  const closed: RepRecord[] = [];
  const dispatch = (batch: EngineEvent[]) => {
    for (const event of batch) {
      if (event.type === 'rep_closed') closed.push(event.rep);
      recorder.event(event);
      rules.handle(event);
    }
  };
  for (const frame of clip.frames) {
    if (isAbsentFrame(frame)) dispatch(engine.pushAbsent(frame.timestamp_ms).events);
    else {
      recorder.pose(frame);
      dispatch(engine.push(frame).events);
    }
  }
  if (!rules.summary()) dispatch(engine.endSet(clip.frames.at(-1)!.timestamp_ms).events);
  const record = recorder.finish(rules.summary()!);
  return { record, closed };
}

describe('direction-aware tempo split and gated range on replays', () => {
  const clips = loadFixtures();

  it.each(['shoulder_press_clean', 'bicep_curl_clean'])('%s splits each rep at its turn', (name) => {
    const clip = clips.find((candidate) => candidate.name === name)!;
    const exercise = getSpec(clip.exercise)!;
    const { record, closed } = recordClip(clip);
    expect(record.reps.length).toBeGreaterThan(0);
    for (const [i, rep] of record.reps.entries()) {
      expect(rep.lowering_ms).toBeGreaterThan(0);
      expect(rep.lowering_ms).toBeLessThan(rep.tempo_ms);
      expect(Math.abs(rep.lowering_ms! - phaseDuration(exercise, closed[i], 'outbound'))).toBeLessThanOrEqual(1);
    }
  });

  it('does not credit range with an arms-down angle before a short press', () => {
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
    const { record, closed } = recordClip(clip);
    expect(record.reps).toHaveLength(1);
    const rep = closed[0];
    const counted = rep.windows.rep.filter((f) => f.t <= rep.countedAt && f.metrics.elbow != null);
    const armsDown = Math.max(...counted.filter((f) => f.metrics.arm_raise! > 60).map((f) => f.metrics.elbow!));
    const lowest = Math.min(...counted.map((f) => f.metrics.elbow!));
    expect(armsDown).toBeGreaterThan(rep.extreme + 10);
    // The credited range must top out at the press, not at the straight arms hanging down.
    expect(record.reps[0].range_deg).toBeLessThan(armsDown - lowest);
    expect(record.reps[0].range_deg).toBeLessThanOrEqual(rep.extreme - lowest + 0.05);
  });
});

describe('committed clips through engine → rules → recorder', () => {
  const snapshots = path.resolve(__dirname, '../../../../../specs/set-record/fixtures/valid/SetRecord');
  const clips = loadFixtures();

  it.each(['rep_started', 'rep_counted'] as const)('manual end after %s flushes the engine before finish', (stopAt) => {
    const clip = clips.find((candidate) => candidate.name === 'squat_clean')!;
    const engine = createFormEngine(spec, { imageAspect: clip.image.width / clip.image.height });
    const rules = createSetRules(spec);
    const recorder = createSetRecorder(spec, { setIndex: 0 });
    for (const frame of clip.frames) {
      if (isAbsentFrame(frame)) continue;
      recorder.pose(frame);
      const update = engine.push(frame);
      for (const event of update.events) {
        recorder.event(event);
        rules.handle(event);
      }
      if (!update.events.some((event) => event.type === stopAt)) continue;
      expect(() => recorder.finish(flagsFor(0))).toThrow('set_ended');
      for (const event of engine.endSet(frame.timestamp_ms).events) {
        recorder.event(event);
        rules.handle(event);
      }
      const record = recorder.finish(rules.summary()!);
      expect(record.reps).toHaveLength(stopAt === 'rep_counted' ? 1 : 0);
      expect(record.partial_reps).toBe(stopAt === 'rep_started' ? 1 : 0);
      expect(record.end_reason).toBe('manual');
      expectIntegerRelations(record);
      return;
    }
    throw new Error(`clip did not emit ${stopAt}`);
  });

  it.each(clips.map((clip) => [clip.name, clip] as const))('%s matches its SetRecord snapshot', (name, clip) => {
    const exercise = getSpec(clip.exercise)!;
    const engine = createFormEngine(exercise, { imageAspect: clip.image.width / clip.image.height });
    const rules = createSetRules(exercise);
    const recorder = createSetRecorder(exercise, { setIndex: 0 });
    const events: EngineEvent[] = [];
    const dispatch = (batch: EngineEvent[]) => {
      for (const event of batch) {
        events.push(event);
        recorder.event(event);
        rules.handle(event);
      }
    };
    for (const frame of clip.frames) {
      if (isAbsentFrame(frame)) dispatch(engine.pushAbsent(frame.timestamp_ms).events);
      else {
        recorder.pose(frame);
        dispatch(engine.push(frame).events);
      }
    }
    expect(events).toEqual(runClip(clip).events);
    if (!rules.summary()) dispatch(engine.endSet(clip.frames.at(-1)!.timestamp_ms).events);
    const flags = rules.summary()!;
    const record = recorder.finish(flags);
    expect(record.reps).toHaveLength(clip.expected!.reps);
    expect(record.partial_reps).toBe(clip.expected!.partials);
    expect(record.end_reason).toBe(clip.expected!.set_end ?? 'manual');
    expect(record.reps.flatMap((rep) => rep.flags.map(({ rule_id, rep_index }) => ({ rule_id, rep_index }))))
      .toEqual(clip.expected!.flags);
    expectIntegerRelations(record);
    const firstStart = events.find((event) => event.type === 'rep_started')!;
    const end = events.find((event) => event.type === 'set_ended')!;
    const kept = clip.frames.filter((frame): frame is PoseResult =>
      !isAbsentFrame(frame) && frame.timestamp_ms >= firstStart.t - LEAD_IN_MS && frame.timestamp_ms <= end.t,
    ).slice(0, MAX_SET_FRAMES);
    expect(record.frames).toEqual(kept.map((frame) => ({
      t_ms: Math.round(frame.timestamp_ms - kept[0].timestamp_ms),
      kp: compactPose(frame).joints.flatMap((joint) => [joint.x, joint.y, joint.c]),
    })));
    const closed = events.flatMap((event) => event.type === 'rep_closed' ? [event.rep] : []);
    expect(record).toEqual(buildSetRecord({
      spec: exercise, setIndex: 0, weightKg: null, poses: kept, reps: closed, flags, partials: record.partial_reps,
    }));
    const file = path.join(snapshots, `${name}.json`);
    const serialized = JSON.stringify(record, null, 2).replace(
      /"kp": \[\s+([\d\s.,-]+)\s+\]/g,
      (_match, values: string) => `"kp": [${values.trim().replace(/\s+/g, '')}]`,
    ) + '\n';
    if (process.env.UPDATE_SET_RECORD_FIXTURES === '1') fs.writeFileSync(file, serialized);
    expect(fs.readFileSync(file, 'utf8')).toBe(serialized);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(record);
  });
});
