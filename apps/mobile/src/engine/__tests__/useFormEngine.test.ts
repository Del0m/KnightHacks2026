import React from 'react';
import { loadFixtures } from '../__fixtures__/load';
import { isAbsentFrame } from '../recording';
import { getSpec } from '../specs';
import { useFormEngine, type FormEngineState } from '../useFormEngine';
import type { EngineEvent, ExerciseSpec } from '../types';

const { act, create } = require('react-test-renderer');

const clip = loadFixtures().find((c) => c.name === 'squat_clean')!;

function mount(spec: ExerciseSpec | null, onEvent?: (e: EngineEvent) => void) {
  const latest: { current: FormEngineState | null } = { current: null };
  let renders = 0;
  function Probe({ s }: { s: ExerciseSpec | null }) {
    renders++;
    latest.current = useFormEngine(s, { imageAspect: clip.image.width / clip.image.height, onEvent });
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(Probe, { s: spec })); });
  const rerender = (s: ExerciseSpec | null) => act(() => renderer.update(React.createElement(Probe, { s })));
  return { latest, renders: () => renders, renderer: renderer!, rerender };
}

describe('useFormEngine', () => {
  it('exposes invalid-spec errors without rendering or counting with unrestricted limits', () => {
    const valid = getSpec('squat')!;
    const bad = { ...valid, phases: { ...valid.phases, target: 150 } };
    const events: EngineEvent[] = [];
    const { latest, renderer, rerender } = mount(bad, (e) => events.push(e));
    expect(latest.current!.error?.message).toMatch(/Invalid exercise spec/);
    for (const f of clip.frames) act(() => latest.current!.onPose(isAbsentFrame(f) ? { latencyMs: 5 } : { result: f, latencyMs: 5 }));
    act(() => { latest.current!.endSet(); latest.current!.reset(); });
    expect(latest.current).toMatchObject({ repCount: 0, primary: null, ended: false });
    expect(events).toEqual([]);
    rerender(valid);
    expect(latest.current!.error).toBeNull();
    for (const f of clip.frames) act(() => latest.current!.onPose(isAbsentFrame(f) ? { latencyMs: 5 } : { result: f, latencyMs: 5 }));
    expect(latest.current!.repCount).toBe(clip.expected!.reps);
    rerender(bad);
    expect(latest.current!.error).not.toBeNull();
    expect(latest.current).toMatchObject({ repCount: 0, primary: null, state: 'start' });
    act(() => renderer.unmount());
  });
  it('counts reps from detections and forwards events', () => {
    const events: EngineEvent[] = [];
    const { latest, renders, renderer } = mount(getSpec('squat')!, (e) => events.push(e));
    for (const f of clip.frames) {
      act(() => latest.current!.onPose(isAbsentFrame(f) ? { latencyMs: 5 } : { result: f, latencyMs: 5 }));
    }
    expect(latest.current!.repCount).toBe(clip.expected!.reps);
    expect(events.filter((e) => e.type === 'rep_counted')).toHaveLength(clip.expected!.reps);
    expect(events.filter((e) => e.type === 'rep_closed')).toHaveLength(clip.expected!.reps);
    // State changes and throttled angle updates only, not one render per frame.
    expect(renders()).toBeLessThan(clip.frames.length / 2);
    act(() => renderer.unmount());
  });

  it('ends and resets a set', () => {
    const { latest, renderer } = mount(getSpec('squat')!);
    act(() => latest.current!.endSet());
    expect(latest.current!.ended).toBe(true);
    act(() => latest.current!.reset());
    expect(latest.current).toMatchObject({ ended: false, repCount: 0, state: 'start' });
    act(() => renderer.unmount());
  });

  it('keeps a running set when the aspect changes', () => {
    const latest: { current: FormEngineState | null } = { current: null };
    function Probe({ aspect }: { aspect?: number }) {
      latest.current = useFormEngine(getSpec('squat')!, { imageAspect: aspect });
      return null;
    }
    const aspect = clip.image.width / clip.image.height;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(React.createElement(Probe, { aspect })); });
    const push = (f: (typeof clip.frames)[number]) =>
      act(() => latest.current!.onPose(isAbsentFrame(f) ? { latencyMs: 5 } : { result: f, latencyMs: 5 }));
    const half = Math.floor(clip.frames.length / 2);
    for (const f of clip.frames.slice(0, half)) push(f);
    expect(latest.current!.repCount).toBeGreaterThan(0);
    // A new resolution mid-set (e.g. the first one arriving late) must not reset the count.
    act(() => renderer.update(React.createElement(Probe, { aspect: aspect * 1.001 })));
    for (const f of clip.frames.slice(half)) push(f);
    expect(latest.current!.repCount).toBe(clip.expected!.reps);
    act(() => renderer.unmount());
  });

  it('shows the primary angle on the first pose after a reset', () => {
    const { latest, renderer } = mount(getSpec('squat')!);
    const poses = clip.frames.filter((f) => !isAbsentFrame(f));
    act(() => latest.current!.onPose({ result: poses[0] as never, latencyMs: 5 }));
    expect(latest.current!.primary).not.toBeNull();
    act(() => latest.current!.reset());
    expect(latest.current!.primary).toBeNull();
    act(() => latest.current!.onPose({ result: poses[1] as never, latencyMs: 5 }));
    expect(latest.current!.primary).not.toBeNull();
    act(() => renderer.unmount());
  });

  it('ignores detections without a spec', () => {
    const { latest, renderer } = mount(null);
    act(() => latest.current!.onPose({ latencyMs: 5 }));
    expect(latest.current).toMatchObject({ repCount: 0, state: 'start', primary: null });
    act(() => renderer.unmount());
  });
});
