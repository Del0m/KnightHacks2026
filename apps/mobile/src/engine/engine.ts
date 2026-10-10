import type { PoseResult } from '../pose/types';
import { createMetricComputer } from './angles';
import { JointSmoother } from './oneEuro';
import { createRepCounter } from './repCounter';
import type {
  CounterStep,
  EngineEvent,
  EngineFrame,
  EngineOptions,
  EngineUpdate,
  ExerciseSpec,
  Metrics,
  MetricSides,
  RepRecord,
  RepTiming,
  RepWindows,
  SmoothedJoints,
} from './types';

export interface FormEngine {
  readonly spec: ExerciseSpec;
  /** One detected pose. */
  push(pose: PoseResult): EngineUpdate;
  /** No person found at `tMs`. A long enough run of these ends the set as `absent`, not `lost`. */
  pushAbsent(tMs: number): EngineUpdate;
  /** Manual set end: closes or drops the open rep, then emits `set_ended`. */
  endSet(tMs: number): EngineUpdate;
  /** Changes the upright aspect mid-set, e.g. once the camera resolution is known or after a flip. */
  setImageAspect(aspect: number | undefined): void;
  reset(): void;
}

interface Attempt {
  outbound: EngineFrame[];
  peak: EngineFrame[];
  return: EngineFrame[];
}

const emptyAttempt = (): Attempt => ({ outbound: [], peak: [], return: [] });

/**
 * Turns a stream of poses into reps for one exercise: One Euro smoothing, the spec's metrics, and
 * the rep state machine on the primary angle. Rep windows are handed over on `rep_closed` for the
 * form rules (AI-07). Behaviour: docs/superpowers/specs/2026-10-10-form-engine-design.md.
 */
export function createFormEngine(spec: ExerciseSpec, options: EngineOptions = {}): FormEngine {
  const primaryName = spec.primary_angle.name;
  const smoother = new JointSmoother({
    filter: options.filter,
    minConfidence: options.minConfidence,
    holdMs: options.holdMs,
  });
  const metricsOf = createMetricComputer(spec, {
    imageAspect: options.imageAspect,
    sideMargin: options.sideMargin,
    minRatioDenominator: options.minRatioDenominator,
  });
  const counter = createRepCounter(spec.primary_angle.direction, spec.phases);
  /** Kept in step with the metric computer's, for `RepRecord.imageAspect`. */
  let imageAspect = options.imageAspect ?? 9 / 16;
  const attempts = new Map<number, Attempt>();
  const emptyMetrics = (): Metrics => Object.fromEntries(Object.keys(spec.angles).map((k) => [k, null]));

  function closeRep(attempt: number, timing: RepTiming): RepRecord {
    const a = attempts.get(attempt) ?? emptyAttempt();
    attempts.delete(attempt);
    const windows: RepWindows = {
      outbound: a.outbound,
      peak: a.peak,
      return: a.return,
      rep: [...a.outbound, ...a.peak, ...a.return],
    };
    const atExtreme = windows.rep.find((f) => f.metrics[primaryName] === timing.extreme);
    return { ...timing, windows, side: atExtreme?.sides[primaryName] ?? null, imageAspect };
  }

  function finish(
    t: number,
    step: CounterStep,
    frame: EngineFrame | null,
    metrics: Metrics,
    sides: MetricSides,
    joints: SmoothedJoints | null,
  ): EngineUpdate {
    // The frame goes in its window before events are handled, so a rep closed by a hold keeps it.
    // Events arrive in order (rep_closed before rep_started), so the side lock ends up right.
    if (frame && step.window) {
      let a = attempts.get(step.window.attempt);
      if (!a) {
        a = emptyAttempt();
        attempts.set(step.window.attempt, a);
      }
      a[step.window.phase].push(frame);
    }

    const events: EngineEvent[] = [];
    for (const e of step.events) {
      switch (e.type) {
        case 'rep_started':
          metricsOf.setLocked(true);
          events.push({ type: 'rep_started', t: e.t });
          break;
        case 'partial':
          attempts.delete(e.attempt);
          metricsOf.setLocked(false);
          events.push({ type: 'partial', t: e.t });
          break;
        case 'rep_counted':
          events.push({ type: 'rep_counted', t: e.t, index: e.index });
          break;
        case 'rep_closed':
          metricsOf.setLocked(false);
          events.push({ type: 'rep_closed', t: e.t, rep: closeRep(e.attempt, e.timing) });
          break;
        case 'set_ended':
          events.push({ type: 'set_ended', t: e.t, reason: e.reason });
          break;
      }
    }
    return {
      t,
      state: step.state,
      repCount: step.repCount,
      ended: step.ended,
      primary: metrics[primaryName] ?? null,
      primarySide: sides[primaryName] ?? null,
      metrics,
      joints,
      events,
    };
  }

  return {
    spec,
    push(pose) {
      const t = pose.timestamp_ms;
      const joints = smoother.push(pose.joints, t);
      const { metrics, sides } = metricsOf.compute(joints);
      const primary = metrics[primaryName] ?? null;
      const step = counter.step(t, primary, true);
      const frame: EngineFrame | null = primary === null ? null : { t, metrics, sides, joints };
      return finish(t, step, frame, metrics, sides, joints);
    },
    pushAbsent(tMs) {
      return finish(tMs, counter.step(tMs, null, false), null, emptyMetrics(), {}, null);
    },
    endSet(tMs) {
      return finish(tMs, counter.end(tMs, 'manual'), null, emptyMetrics(), {}, null);
    },
    setImageAspect(aspect) {
      metricsOf.setImageAspect(aspect);
      imageAspect = aspect ?? 9 / 16;
    },
    reset() {
      smoother.reset();
      metricsOf.reset();
      counter.reset();
      attempts.clear();
    },
  };
}
