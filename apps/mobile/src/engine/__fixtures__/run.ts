import { createFormEngine } from '../engine';
import { isAbsentFrame, type Clip } from '../recording';
import { getSpec } from '../specs';
import type { EngineEvent, EngineOptions, EngineUpdate, RepRecord } from '../types';

export interface ClipRun {
  updates: EngineUpdate[];
  events: EngineEvent[];
  counted: number[];
  partials: number;
  reps: RepRecord[];
  setEnd: EngineEvent & { type: 'set_ended' } | undefined;
}

/** Plays a clip through a fresh engine for its exercise, with the clip's image aspect. */
export function runClip(clip: Clip, options: EngineOptions = {}): ClipRun {
  const spec = getSpec(clip.exercise);
  if (!spec) throw new Error(`unknown exercise ${clip.exercise}`);
  const engine = createFormEngine(spec, { imageAspect: clip.image.width / clip.image.height, ...options });
  const updates = clip.frames.map((f) => (isAbsentFrame(f) ? engine.pushAbsent(f.timestamp_ms) : engine.push(f)));
  const events = updates.flatMap((u) => u.events);
  return {
    updates,
    events,
    counted: events.flatMap((e) => (e.type === 'rep_counted' ? [e.index] : [])),
    partials: events.filter((e) => e.type === 'partial').length,
    reps: events.flatMap((e) => (e.type === 'rep_closed' ? [e.rep] : [])),
    setEnd: events.find((e): e is EngineEvent & { type: 'set_ended' } => e.type === 'set_ended'),
  };
}
