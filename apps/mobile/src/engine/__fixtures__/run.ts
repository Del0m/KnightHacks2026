import { createFormEngine } from '../engine';
import { isAbsentFrame, type Clip } from '../recording';
import { createSetRules } from '../rules';
import { getSpec } from '../specs';
import type {
  EffectiveSpec,
  EngineEvent,
  EngineOptions,
  EngineUpdate,
  ExerciseSpec,
  RepRecord,
  RepResult,
  SetFlags,
} from '../types';

export interface ClipRun {
  updates: EngineUpdate[];
  events: EngineEvent[];
  counted: number[];
  partials: number;
  reps: RepRecord[];
  setEnd: EngineEvent & { type: 'set_ended' } | undefined;
}

/**
 * Plays a clip through a fresh engine for its exercise, with the clip's image aspect. `spec` defaults
 * to the base spec.
 */
export function runClip(clip: Clip, options: EngineOptions = {}, spec = getSpec(clip.exercise)): ClipRun {
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

export interface ClipRulesRun {
  /** One per closed rep, in order. */
  reps: RepResult[];
  /** Set once the clip's engine run ends the set. */
  set: SetFlags | null;
}

/** Plays a clip and feeds every engine event to `createSetRules`. `spec` defaults to the base spec. */
export function runClipRules(clip: Clip, spec: ExerciseSpec | EffectiveSpec = getSpec(clip.exercise)!): ClipRulesRun {
  const rules = createSetRules(spec);
  const reps: RepResult[] = [];
  let set: SetFlags | null = null;
  for (const e of runClip(clip).events) {
    const out = rules.handle(e);
    if (out?.type === 'rep_evaluated') reps.push(out.result);
    if (out?.type === 'set_flags') set = out.set;
  }
  return { reps, set };
}
