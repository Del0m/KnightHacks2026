import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { JOINT_NAMES } from '../../pose/types';
import { getSpec } from '../specs';
import type { EngineEvent, ExerciseSpec, RepRecord, SetFlags, View } from '../types';
import { MIN_TINT_MS, useFormRules, type FormRulesState } from '../useFormRules';
import { applyInjuries } from '../overrides';

const squat = getSpec('squat')!;

/** A side-on squat rep with the given bottom angle and trunk lean, one frame per 100 ms. */
function squatRep(index: number, knee: number, trunk: number): RepRecord {
  const joints = JOINT_NAMES.map((n) => ({ x: 0.5, y: n.endsWith('shoulder') ? 0.3 : n.endsWith('hip') ? 0.6 : 0.5, c: 0.9 }));
  const frame = (t: number, k: number) => ({ t, metrics: { knee: k, trunk, knee_width_ratio: null }, sides: {}, joints });
  const outbound = [frame(0, 150), frame(1000, knee)];
  const peak = [frame(1100, knee), frame(1200, knee + 3)];
  const ret = [frame(1300, 140), frame(1400, 166)];
  return {
    index,
    startedAt: 0,
    peakAt: 1000,
    returnAt: 1300,
    countedAt: 1400,
    closedAt: 1400,
    extreme: knee,
    durations: { outbound: 1000, peak: 300, return: 100, rep: 1400 },
    windows: { outbound, peak, return: ret, rep: [...outbound, ...peak, ...ret] },
    side: 'left',
    imageAspect: 9 / 16,
  };
}

const closed = (rep: RepRecord): EngineEvent => ({ type: 'rep_closed', t: rep.closedAt, rep });

function mount(spec: ExerciseSpec | null, opts: { view?: View; onSetFlags?: (s: SetFlags) => void; inlineInjuries?: boolean } = {}) {
  const latest: { current: FormRulesState | null } = { current: null };
  let renders = 0;
  function Probe({ s, v }: { s: ExerciseSpec | null; v?: View }) {
    renders++;
    latest.current = useFormRules(s && opts.inlineInjuries ? applyInjuries(s, ['lower_back']) : s, { view: v, onSetFlags: opts.onSetFlags });
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(Probe, { s: spec, v: opts.view })); });
  const send = (e: EngineEvent) => act(() => latest.current!.onEvent(e));
  const rerender = (s: ExerciseSpec | null, v?: View) => act(() => renderer.update(React.createElement(Probe, { s, v })));
  return { latest, send, rerender, renders: () => renders, renderer: renderer! };
}

describe('useFormRules', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('keeps held reps across inline injury applications and equivalent spec objects', () => {
    const { latest, send, rerender, renderer } = mount(squat, { inlineInjuries: true });
    send(closed(squatRep(1, 90, 10)));
    rerender({ ...squat, phases: { ...squat.phases } });
    send(closed(squatRep(2, 110, 10)));
    send({ type: 'set_ended', t: 9000, reason: 'manual' });
    expect(latest.current!.summary).toMatchObject({ total_reps: 2, clean_reps: 1 });
    rerender({ ...squat, phases: { ...squat.phases, count_min: 130 } });
    expect(latest.current!.summary).toBeNull();
    act(() => renderer.unmount());
  });

  it('shows a batched tint for at least 300 ms and cancels stale clears', () => {
    const { latest, renderer, send } = mount(squat);
    act(() => {
      latest.current!.onEvent(closed(squatRep(1, 110, 60)));
      latest.current!.onEvent({ type: 'rep_started', t: 1500 });
    });
    expect(latest.current!.tintJoints.length).toBeGreaterThan(0);
    act(() => jest.advanceTimersByTime(MIN_TINT_MS - 1));
    expect(latest.current!.tintJoints.length).toBeGreaterThan(0);
    act(() => jest.advanceTimersByTime(1));
    expect(latest.current!.tintJoints).toEqual([]);
    send(closed(squatRep(2, 110, 60)));
    send({ type: 'rep_started', t: 2500 });
    act(() => jest.advanceTimersByTime(100));
    send(closed(squatRep(3, 110, 60)));
    act(() => jest.advanceTimersByTime(200));
    expect(latest.current!.tintJoints.length).toBeGreaterThan(0);
    send({ type: 'set_ended', t: 9000, reason: 'manual' });
    expect(latest.current!.tintJoints).toEqual([]);
    act(() => renderer.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });
  it('exposes invalid-spec errors and resumes only when given valid limits', () => {
    const bad = { ...squat, phases: { ...squat.phases, target: 150 } };
    const got: SetFlags[] = [];
    const { latest, send, rerender, renderer } = mount(bad, { onSetFlags: (s) => got.push(s) });
    expect(latest.current!.error?.message).toMatch(/Invalid exercise spec/);
    send(closed(squatRep(1, 90, 60)));
    send({ type: 'set_ended', t: 9000, reason: 'manual' });
    expect(latest.current).toMatchObject({ tintJoints: [], lastRep: null, summary: null });
    expect(got).toEqual([]);
    rerender(squat);
    expect(latest.current!.error).toBeNull();
    send(closed(squatRep(1, 90, 60)));
    expect(latest.current!.lastRep!.flags).toHaveLength(1);
    rerender(bad);
    expect(latest.current!.error).not.toBeNull();
    expect(latest.current).toMatchObject({ tintJoints: [], lastRep: null, summary: null });
    act(() => renderer.unmount());
  });
  it('tints a flagged rep until the next rep starts', () => {
    const { latest, send, renders, renderer } = mount(squat);
    send({ type: 'rep_started', t: 0 });
    send(closed(squatRep(1, 90, 60)));
    expect(latest.current!.tintJoints).toEqual(['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']);
    expect(latest.current!.lastRep).toMatchObject({ rep_index: 0, view: 'side', flags: [{ rule_id: 'trunk_lean' }] });
    send({ type: 'rep_started', t: 2000 });
    act(() => jest.advanceTimersByTime(MIN_TINT_MS));
    expect(latest.current!.tintJoints).toEqual([]);
    expect(latest.current!.lastRep?.rep_index).toBe(0);

    // Events that change nothing visible don't re-render.
    const before = renders();
    send({ type: 'rep_counted', t: 3000, index: 2 });
    send({ type: 'partial', t: 3100 });
    send({ type: 'rep_started', t: 3200 });
    expect(renders()).toBe(before);
    act(() => renderer.unmount());
  });

  it('releases the set on set_ended and clears the tint', () => {
    const got: SetFlags[] = [];
    const { latest, send, renderer } = mount(squat, { onSetFlags: (s) => got.push(s) });
    send(closed(squatRep(1, 90, 10)));
    expect(latest.current!.tintJoints).toEqual([]);
    send(closed(squatRep(2, 110, 60)));
    expect(latest.current!.tintJoints.length).toBeGreaterThan(0);
    expect(latest.current!.summary).toBeNull();
    send({ type: 'set_ended', t: 9000, reason: 'still' });
    expect(latest.current!.tintJoints).toEqual([]);
    expect(latest.current!.summary).toMatchObject({ total_reps: 2, clean_reps: 1, reason: 'still', top: { rule_id: 'depth' } });
    expect(got).toEqual([latest.current!.summary]);

    // Ignored after the set ends, until reset.
    send(closed(squatRep(3, 120, 60)));
    expect(latest.current!.lastRep?.rep_index).toBe(1);
    act(() => latest.current!.reset());
    expect(latest.current).toMatchObject({ tintJoints: [], lastRep: null, summary: null });
    send(closed(squatRep(1, 120, 10)));
    expect(latest.current!.lastRep?.flags.map((f) => f.rule_id)).toEqual(['depth']);
    act(() => renderer.unmount());
  });

  it('uses the caller view and rebuilds when it changes', () => {
    const { latest, send, rerender, renderer } = mount(squat, { view: 'front' });
    send(closed(squatRep(1, 90, 60)));
    expect(latest.current!.lastRep).toMatchObject({ view: 'front', view_source: 'caller', flags: [] });
    rerender(squat, undefined);
    expect(latest.current).toMatchObject({ tintJoints: [], lastRep: null, summary: null });
    send(closed(squatRep(1, 90, 60)));
    expect(latest.current!.lastRep).toMatchObject({ view: 'side', view_source: 'detected' });
    act(() => renderer.unmount());
  });

  it('ignores events without a spec', () => {
    const { latest, send, renderer } = mount(null);
    send(closed(squatRep(1, 120, 60)));
    send({ type: 'set_ended', t: 0, reason: 'manual' });
    expect(latest.current).toMatchObject({ tintJoints: [], lastRep: null, summary: null });
    act(() => renderer.unmount());
  });
});
