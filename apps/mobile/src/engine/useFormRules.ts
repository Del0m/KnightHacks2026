import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSetRules, type SetRules } from './rules';
import type { EffectiveSpec, EngineEvent, ExerciseSpec, RepResult, SetFlags, View } from './types';

export interface FormRulesState {
  /** Invalid effective spec: evaluation is disabled until a valid spec is supplied. */
  error: Error | null;
  /** Chain from `useFormEngine`'s `onEvent`. */
  onEvent: (e: EngineEvent) => void;
  /** The last closed rep's flagged joints; [] after `rep_started`, `set_ended` or `reset`. */
  tintJoints: string[];
  lastRep: RepResult | null;
  /** Set once `set_ended` arrives. */
  summary: SetFlags | null;
  /** Call with the engine's reset for a new set. */
  reset: () => void;
}

interface Published {
  /** The `SetRules` this state belongs to; state from an older one reads as empty. */
  rules: SetRules | null;
  tintJoints: string[];
  lastRep: RepResult | null;
  summary: SetFlags | null;
}

const NO_JOINTS: string[] = [];
const empty = (rules: SetRules | null): Published => ({ rules, tintJoints: NO_JOINTS, lastRep: null, summary: null });

/**
 * Runs the form rules on engine events: an amber tint per closed rep, and the held flags when the
 * set ends. Re-renders only when the tint, the last rep or the summary changes. The rules are
 * rebuilt when `spec` or `view` changes; `onSetFlags` is read at call time.
 */
export function useFormRules(
  spec: ExerciseSpec | EffectiveSpec | null,
  opts: { view?: View; onSetFlags?: (s: SetFlags) => void } = {},
): FormRulesState {
  const { view, onSetFlags } = opts;
  const onSetFlagsRef = useRef(onSetFlags);
  useEffect(() => {
    onSetFlagsRef.current = onSetFlags;
  }, [onSetFlags]);

  const { rules, error } = useMemo(() => {
    try {
      return { rules: spec ? createSetRules(spec, { view }) : null, error: null };
    } catch (cause) {
      return { rules: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }, [spec, view]);
  const [published, setPublished] = useState<Published>(() => empty(rules));
  const current = published.rules === rules ? published : empty(rules);
  // Whether a tint may be showing, so clearing an empty tint doesn't even queue an update.
  const tinted = useRef(false);

  const clearTint = useCallback(
    (s: Published): Published => {
      const c = s.rules === rules ? s : empty(rules);
      return c.tintJoints.length === 0 ? c : { ...c, tintJoints: NO_JOINTS };
    },
    [rules],
  );

  const onEvent = useCallback(
    (e: EngineEvent) => {
      if (!rules) return;
      const out = rules.handle(e);
      if (out?.type === 'rep_evaluated') {
        const { result } = out;
        tinted.current = result.tint_joints.length > 0;
        setPublished((s) => ({ ...(s.rules === rules ? s : empty(rules)), tintJoints: result.tint_joints, lastRep: result }));
      } else if (out?.type === 'set_flags') {
        const { set } = out;
        tinted.current = false;
        setPublished((s) => ({ ...clearTint(s), summary: set }));
        onSetFlagsRef.current?.(set);
      } else if (e.type === 'rep_started' && tinted.current) {
        tinted.current = false;
        setPublished(clearTint);
      }
    },
    [rules, clearTint],
  );

  const reset = useCallback(() => {
    rules?.reset();
    tinted.current = false;
    setPublished((s) =>
      s.rules === rules && s.tintJoints.length === 0 && s.lastRep === null && s.summary === null ? s : empty(rules),
    );
  }, [rules]);

  return { error, onEvent, tintJoints: current.tintJoints, lastRep: current.lastRep, summary: current.summary, reset };
}
