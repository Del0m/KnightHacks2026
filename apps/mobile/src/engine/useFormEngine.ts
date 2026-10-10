import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PoseDetection } from '../pose/types';
import { createFormEngine } from './engine';
import type { EngineEvent, EngineOptions, EngineUpdate, ExerciseSpec, MetricSide, RepState } from './types';

const PRIMARY_INTERVAL_MS = 250;

export interface FormEngineState {
  /** Pass to `usePoseOutput({ onPose })`. */
  onPose: (d: PoseDetection) => void;
  state: RepState;
  repCount: number;
  ended: boolean;
  /** Primary angle and its side, published at most every 250 ms (for readouts, not logic). */
  primary: number | null;
  primarySide: MetricSide | null;
  /** Ends the set by hand (e.g. a Done button). */
  endSet: () => void;
  /** Starts a fresh set with the same spec. */
  reset: () => void;
}

/**
 * Runs the form engine on pose detections. Re-renders when the rep state, count or set end changes,
 * plus the throttled primary angle. Every engine event (rep windows included) goes to `onEvent`.
 * The engine is rebuilt when `spec` or `imageAspect` changes; other options are read at that time.
 */
export function useFormEngine(
  spec: ExerciseSpec | null,
  opts: EngineOptions & {
    onEvent?: (e: EngineEvent) => void;
    /** Every frame's full update, e.g. for a recorder or the skeleton tint. */
    onUpdate?: (u: EngineUpdate) => void;
  } = {},
): FormEngineState {
  const { imageAspect } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const engine = useMemo(
    () => (spec ? createFormEngine(spec, { ...optsRef.current, imageAspect }) : null),
    [spec, imageAspect],
  );

  const [state, setState] = useState<RepState>('start');
  const [repCount, setRepCount] = useState(0);
  const [ended, setEnded] = useState(false);
  const [primary, setPrimary] = useState<{ value: number | null; side: MetricSide | null }>({ value: null, side: null });
  const primaryAt = useRef(0);

  const publish = useCallback((u: EngineUpdate) => {
    setState(u.state);
    setRepCount(u.repCount);
    setEnded(u.ended);
    const now = Date.now();
    if (now - primaryAt.current >= PRIMARY_INTERVAL_MS) {
      primaryAt.current = now;
      setPrimary((p) => (p.value === u.primary && p.side === u.primarySide ? p : { value: u.primary, side: u.primarySide }));
    }
    for (const e of u.events) optsRef.current.onEvent?.(e);
    optsRef.current.onUpdate?.(u);
  }, []);

  useEffect(() => {
    setState('start');
    setRepCount(0);
    setEnded(false);
    setPrimary({ value: null, side: null });
  }, [engine]);

  const onPose = useCallback(
    (d: PoseDetection) => {
      if (!engine) return;
      publish(d.result ? engine.push(d.result) : engine.pushAbsent(Date.now()));
    },
    [engine, publish],
  );

  const endSet = useCallback(() => {
    if (engine) publish(engine.endSet(Date.now()));
  }, [engine, publish]);

  const reset = useCallback(() => {
    if (!engine) return;
    engine.reset();
    setState('start');
    setRepCount(0);
    setEnded(false);
    setPrimary({ value: null, side: null });
  }, [engine]);

  return { onPose, state, repCount, ended, primary: primary.value, primarySide: primary.side, endSet, reset };
}
