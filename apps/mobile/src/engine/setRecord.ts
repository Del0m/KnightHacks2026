import type { Flag, JointFrame, Rep, SetRecord } from '../../../../specs/set-record/types';
import { isPoseResult, type PoseResult } from '../pose/types';
import type { EngineEvent, ExerciseSpec, RepRecord, SetEndReason, SetFlags } from './types';

export type { SetRecord };

export const MAX_SET_FRAMES = 5400;
export const LEAD_IN_MS = 1000;
const MAX_SET_REPS = 200;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places || 0;

function requireContract(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`SetRecord: ${message}`);
}

function integerInRange(value: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function validatePose(pose: PoseResult, previous: number): void {
  requireContract(isPoseResult(pose), 'malformed pose');
  for (const joint of pose.joints) {
    requireContract(
      joint != null && [joint.x * 10000, joint.y * 10000, joint.c * 100].every(Number.isFinite),
      'malformed pose',
    );
  }
  requireContract(pose.timestamp_ms >= 0 && pose.timestamp_ms > previous, 'pose timestamps must strictly increase');
}

export interface SetRecordInput {
  spec: ExerciseSpec;
  setIndex: number;
  weightKg: number | null;
  poses: PoseResult[];
  reps: RepRecord[];
  flags: SetFlags;
  partials: number;
}

interface RepSummary {
  index: number;
  startedAt: number;
  countedAt: number;
  bottomAt: number | null;
  range: number;
}

function summarizeRep(spec: ExerciseSpec, rep: RepRecord, position: number): RepSummary {
  requireContract(rep.index === position + 1, 'closed rep indices must be consecutive and 1-based');
  requireContract(
    Number.isFinite(rep.startedAt) && Number.isFinite(rep.countedAt) && Number.isFinite(rep.closedAt) &&
      rep.startedAt >= 0 && rep.countedAt >= rep.startedAt && rep.closedAt >= rep.countedAt,
    'invalid rep timestamps',
  );
  requireContract(
    Number.isFinite(rep.durations.rep) && Math.abs(rep.durations.rep - (rep.countedAt - rep.startedAt)) < 0.000001,
    'rep duration disagrees with startedAt/countedAt',
  );
  let minimum = Infinity;
  let maximum = -Infinity;
  let bottomAt: number | null = null;
  let bottomValue = Infinity;
  let previous = -Infinity;
  for (const frame of rep.windows.rep) {
    requireContract(Number.isFinite(frame.t) && frame.t >= previous, 'rep window timestamps must be finite and ordered');
    previous = frame.t;
    const value = frame.metrics[spec.primary_angle.name];
    if (value == null) continue;
    requireContract(Number.isFinite(value), 'non-finite primary angle');
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    if (frame.t >= rep.startedAt && frame.t <= rep.countedAt && value < bottomValue) {
      bottomValue = value;
      bottomAt = frame.t;
    }
  }
  const range = maximum >= minimum ? maximum - minimum : 0;
  requireContract(range <= 180, 'primary angle range exceeds 180 degrees');
  return { index: rep.index, startedAt: rep.startedAt, countedAt: rep.countedAt, bottomAt, range: round(range, 1) };
}

function frameOf(pose: PoseResult, origin: number): JointFrame {
  const t_ms = Math.round(pose.timestamp_ms - origin);
  requireContract(integerInRange(t_ms), 'frame time is outside the set clock');
  return {
    t_ms,
    kp: pose.joints.flatMap((joint) => [round(joint.x, 4), round(joint.y, 4), round(joint.c, 2)]),
  };
}

function repOf(rep: RepSummary, origin: number, flags: Flag[]): Rep {
  const start_ms = Math.round(rep.startedAt - origin);
  const end_ms = Math.round(rep.countedAt - origin);
  const tempo_ms = end_ms - start_ms;
  const lowering_ms = rep.bottomAt === null ? null : Math.round(rep.bottomAt - origin) - start_ms;
  requireContract(integerInRange(start_ms) && integerInRange(end_ms), 'rep time is outside the set clock');
  requireContract(integerInRange(tempo_ms, 120000), 'rep tempo exceeds 120000 ms');
  return {
    rep_index: rep.index - 1,
    start_ms,
    end_ms,
    tempo_ms,
    range_deg: rep.range,
    quality: null,
    lowering_ms,
    rising_ms: lowering_ms === null ? null : tempo_ms - lowering_ms,
    flags: flags.map((flag) => ({ rule_id: flag.rule_id, severity: flag.severity, rep_index: flag.rep_index })),
  };
}

function packageSetRecord(input: Omit<SetRecordInput, 'reps'> & { reps: RepSummary[] }): SetRecord {
  const { spec, poses, reps, flags } = input;
  requireContract(integerInRange(input.setIndex, 200), 'setIndex must be an integer from 0 to 200');
  requireContract(
    input.weightKg === null || (Number.isFinite(input.weightKg) && input.weightKg >= 0 && input.weightKg <= 1000),
    'weightKg must be null or from 0 to 1000',
  );
  requireContract(/^[a-z0-9_]{2,60}$/.test(spec.id), 'invalid exercise id');
  requireContract(integerInRange(input.partials), 'partials must be a nonnegative integer');
  requireContract(poses.length <= MAX_SET_FRAMES, 'more than 5400 frames');
  requireContract(reps.length <= MAX_SET_REPS, 'more than 200 reps');
  requireContract(flags.exercise_id === spec.id, 'set flags exercise does not match');
  requireContract(['still', 'absent', 'lost', 'manual'].includes(flags.reason), 'invalid end reason');
  requireContract(flags.total_reps === reps.length, 'set flags count does not match closed reps');
  requireContract(flags.reps.length === reps.length, 'set flags must cover every closed rep');
  flags.reps.forEach((result, position) => {
    requireContract(result.rep_index === position, 'set flags rep indices must match array positions');
    requireContract(result.flags.length <= 20, 'more than 20 flags on a rep');
    for (const flag of result.flags) {
      requireContract(flag.rep_index === position, 'flag rep_index does not match its rep');
      requireContract(/^[a-z0-9_]{1,60}$/.test(flag.rule_id), 'invalid flag rule_id');
      requireContract(flag.severity === 'form' || flag.severity === 'safety', 'invalid flag severity');
    }
  });
  const perRepFlags = flags.reps.flatMap((result) => result.flags);
  requireContract(
    flags.flags.length === perRepFlags.length && flags.flags.every((flag, position) => {
      const expected = perRepFlags[position];
      return flag.rep_index === expected.rep_index && flag.rule_id === expected.rule_id && flag.severity === expected.severity;
    }),
    'set flags disagree with per-rep flags',
  );
  const origin = poses[0]?.timestamp_ms ?? reps[0]?.startedAt ?? 0;
  let previous = -Infinity;
  const frames = poses.map((pose) => {
    validatePose(pose, previous);
    previous = pose.timestamp_ms;
    return frameOf(pose, origin);
  });
  const span = frames.length >= 2 ? frames[frames.length - 1].t_ms : 0;
  const fps = frames.length < 2 ? null : round(((frames.length - 1) * 1000) / span, 1);
  requireContract(fps === null || (Number.isFinite(fps) && fps > 0 && fps <= 240), 'frame span produces fps outside (0, 240]');
  return {
    schema_version: 1,
    set_index: input.setIndex,
    exercise_id: spec.id,
    weight_kg: input.weightKg,
    end_reason: flags.reason,
    partial_reps: input.partials,
    fps,
    frames,
    reps: reps.map((rep, position) => repOf(rep, origin, flags.reps[position].flags)),
  };
}

export function buildSetRecord(input: SetRecordInput): SetRecord {
  return packageSetRecord({ ...input, reps: input.reps.map((rep, position) => summarizeRep(input.spec, rep, position)) });
}

export interface SetRecorder {
  pose(result: PoseResult): void;
  event(event: EngineEvent): void;
  finish(flags: SetFlags): SetRecord;
  reset(): void;
}

export function createSetRecorder(
  spec: ExerciseSpec,
  opts: { setIndex: number; weightKg?: number | null },
): SetRecorder {
  const setIndex = opts.setIndex;
  const weightKg = opts.weightKg ?? null;
  let poses: PoseResult[] = [];
  let reps: RepSummary[] = [];
  let partials = 0;
  let started = false;
  let endReason: SetEndReason | null = null;
  let lastPose = -Infinity;
  let lastEvent = -Infinity;

  return {
    pose(result) {
      if (endReason !== null) return;
      validatePose(result, lastPose);
      lastPose = result.timestamp_ms;
      if (!started) {
        const from = result.timestamp_ms - LEAD_IN_MS;
        while (poses.length && (poses[0].timestamp_ms < from || poses.length >= MAX_SET_FRAMES)) poses.shift();
      }
      if (poses.length < MAX_SET_FRAMES) {
        poses.push({ ...result, joints: result.joints.map((joint) => ({ ...joint })) });
      }
    },
    event(event) {
      if (endReason !== null) return;
      requireContract(Number.isFinite(event.t) && event.t >= 0 && event.t >= lastEvent, 'event timestamps must be finite and ordered');
      switch (event.type) {
        case 'rep_started':
          if (!started) {
            started = true;
            poses = poses.filter((pose) => pose.timestamp_ms >= event.t - LEAD_IN_MS);
          }
          break;
        case 'partial':
          partials += 1;
          break;
        case 'rep_closed':
          requireContract(reps.length < MAX_SET_REPS, 'more than 200 reps');
          reps.push(summarizeRep(spec, event.rep, reps.length));
          break;
        case 'set_ended':
          endReason = event.reason;
          break;
      }
      lastEvent = event.t;
    },
    finish(flags) {
      requireContract(endReason !== null, 'finish requires set_ended; end the engine set first');
      requireContract(flags.reason === endReason, 'set flags end reason does not match set_ended');
      return packageSetRecord({ spec, setIndex, weightKg, poses, reps, flags, partials });
    },
    reset() {
      poses = [];
      reps = [];
      partials = 0;
      started = false;
      endReason = null;
      lastPose = -Infinity;
      lastEvent = -Infinity;
    },
  };
}
