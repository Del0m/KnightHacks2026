import type {
  CounterEvent,
  CounterStep,
  Direction,
  FrameWindow,
  Phases,
  RepState,
  RepTiming,
  SetEndReason,
} from './types';

/** Rep state machine over the primary angle. Pure: it only sees `(t, value)`. */
export interface RepCounter {
  /** `value` is the primary angle this frame, or null when it could not be measured. */
  step(t: number, value: number | null): CounterStep;
  /** Ends the set. Used for manual ends and internally for `still` and `absent`. */
  end(t: number, reason: SetEndReason): CounterStep;
  reset(): void;
}

interface Hold {
  anchor: number;
  ms: number;
}

interface Tail {
  attempt: number;
  timing: Omit<RepTiming, 'closedAt'>;
  /** Shallowest value since the count. */
  best: number;
  /** `best` when the hold last restarted, and the active time since. */
  hold: Hold;
}

/**
 * The settle tail's hold restarts whenever the angle gains this much toward the start, so a slow
 * lockout keeps its window open until it stops rising.
 */
const SETTLE_PROGRESS_DEG = 1;

/**
 * Creates the counter described in the form engine design (§3). `direction` and `phases` come
 * straight from the exercise spec, after any injury override.
 */
export function createRepCounter(direction: Direction, phases: Phases): RepCounter {
  const s = direction === 'decreasing' ? 1 : -1;
  const deeper = (v: number, x: number) => s * (x - v) > 0;
  const shallower = (v: number, x: number) => s * (v - x) > 0;

  let state: RepState;
  let repCount: number;
  let ended: boolean;
  let attempt: number;
  let stateMs: number;
  let prevT: number | null;
  let firstNullT: number | null;
  let startedAt: number;
  let peakAt: number;
  let returnAt: number;
  let extreme: number;
  let tail: Tail | null;
  let still: Hold | null;

  function init() {
    state = 'start';
    repCount = 0;
    ended = false;
    attempt = 0;
    stateMs = 0;
    prevT = null;
    firstNullT = null;
    startedAt = 0;
    peakAt = 0;
    returnAt = 0;
    extreme = 0;
    tail = null;
    still = null;
  }
  init();

  const result = (window: FrameWindow | null, events: CounterEvent[]): CounterStep => ({
    state,
    repCount,
    ended,
    window,
    events,
  });

  function enter(next: RepState) {
    state = next;
    stateMs = 0;
  }

  /** Adds the frame's active time to the hold and reports whether it reached `limitMs`. */
  function advanceHold(hold: Hold, v: number, dt: number, limitMs: number): boolean {
    if (Math.abs(v - hold.anchor) > phases.reverse_deg) {
      hold.anchor = v;
      hold.ms = 0;
      return false;
    }
    hold.ms += dt;
    return hold.ms >= limitMs;
  }

  function closeTail(t: number, events: CounterEvent[]) {
    if (!tail) return;
    events.push({ type: 'rep_closed', t, attempt: tail.attempt, timing: { ...tail.timing, closedAt: t } });
    tail = null;
  }

  function finish(t: number, reason: SetEndReason, events: CounterEvent[]) {
    closeTail(t, events);
    if (state !== 'start') {
      events.push({ type: 'partial', t, attempt });
      enter('start');
    }
    events.push({ type: 'set_ended', t, reason });
    ended = true;
    still = null;
  }

  function step(t: number, value: number | null): CounterStep {
    if (ended) return result(null, []);
    const events: CounterEvent[] = [];

    if (value === null) {
      prevT = null;
      if (firstNullT === null) firstNullT = t;
      if (repCount >= 1 && t - firstNullT >= phases.set_end_still_ms) finish(t, 'absent', events);
      return result(null, events);
    }

    const v = value;
    const dt = prevT === null ? 0 : Math.max(0, t - prevT);
    prevT = t;
    firstNullT = null;
    stateMs += dt;
    const from = state;
    const gated = stateMs >= phases.min_state_ms;

    let heldClose: number | null = null;
    if (tail) {
      if (s * (v - tail.best) > 0) tail.best = v;
      if (s * (tail.best - v) >= phases.reverse_deg) {
        closeTail(t, events);
      } else if (s * (tail.best - tail.hold.anchor) >= SETTLE_PROGRESS_DEG) {
        tail.hold = { anchor: tail.best, ms: 0 };
      } else if ((tail.hold.ms += dt) >= phases.min_state_ms) {
        heldClose = tail.attempt;
        closeTail(t, events);
      }
    }

    if (state !== 'start' && deeper(v, extreme)) extreme = v;

    switch (state) {
      case 'start':
        if (gated && deeper(v, phases.start_exit)) {
          closeTail(t, events);
          heldClose = null;
          attempt += 1;
          enter('outbound');
          startedAt = t;
          extreme = v;
          still = null;
          events.push({ type: 'rep_started', t, attempt });
        }
        break;
      case 'outbound':
        if (gated && deeper(extreme, phases.count_min)) {
          enter('peak');
          peakAt = t;
        } else if (gated && shallower(v, phases.start_enter)) {
          enter('start');
          still = { anchor: v, ms: 0 };
          events.push({ type: 'partial', t, attempt });
        }
        break;
      case 'peak':
        if (gated && s * (v - extreme) >= phases.reverse_deg) {
          enter('return');
          returnAt = t;
        }
        break;
      case 'return':
        if (gated && shallower(v, phases.start_enter)) {
          enter('start');
          repCount += 1;
          const timing = {
            index: repCount,
            startedAt,
            peakAt,
            returnAt,
            countedAt: t,
            extreme,
            durations: {
              outbound: peakAt - startedAt,
              peak: returnAt - peakAt,
              return: t - returnAt,
              rep: t - startedAt,
            },
          };
          tail = { attempt, timing, best: v, hold: { anchor: v, ms: 0 } };
          still = { anchor: v, ms: 0 };
          events.push({ type: 'rep_counted', t, attempt, index: repCount });
        }
        break;
    }

    if (state === 'start' && from === 'start') {
      if (still === null) still = { anchor: v, ms: 0 };
      else if (advanceHold(still, v, dt, phases.set_end_still_ms) && repCount >= 1) {
        finish(t, 'still', events);
        return result(null, events);
      }
    }

    let window: FrameWindow | null = null;
    if (state !== 'start') window = { attempt, phase: state };
    else if (tail) window = { attempt: tail.attempt, phase: 'return' };
    else if (heldClose !== null) window = { attempt: heldClose, phase: 'return' };
    return result(window, events);
  }

  function end(t: number, reason: SetEndReason): CounterStep {
    if (ended) return result(null, []);
    const events: CounterEvent[] = [];
    finish(t, reason, events);
    return result(null, events);
  }

  return { step, end, reset: init };
}
