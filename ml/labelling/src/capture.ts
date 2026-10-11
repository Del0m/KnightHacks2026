import type { ConsentRecord, DatasetClip, DatasetFrame } from './contract.ts';
import { assertClip, validateConsent } from './validate.ts';

type Meta = Omit<DatasetClip, 'frames' | 'annotations' | 'suggestions' | 'status' | 'stop_reason'>;
type Detection = { result?: { timestamp_ms: number; score: number; joints: { x: number; y: number; c: number }[]; source: string; model: string } };
type StopReason = Exclude<DatasetClip['stop_reason'], null>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

/** The adapter supplies a fresh pose clock and calls tick even when inference is silent. */
export function createCapture(meta: Meta, consent: ConsentRecord, now: () => number = Date.now) {
  const consentErrors = validateConsent(consent);
  if (consentErrors.length) throw Error(consentErrors.join('\n'));
  if (consent.status !== 'active' || consent.participant_id !== meta.participant_id || consent.reference !== meta.consent.reference || consent.version !== 'joint-capture-v1' || consent.purpose !== 'private_model_development' || !meta.consent.allowed_use || meta.consent.version !== consent.version || meta.consent.purpose !== consent.purpose) throw Error('Capture requires matching active consent');
  if (!Number.isInteger(meta.image.width) || !Number.isInteger(meta.image.height) || meta.image.width <= 0 || meta.image.height <= 0) throw Error('Capture requires known integer frame dimensions');
  if (!['coreml', 'vision'].includes(meta.source) || !meta.model.trim()) throw Error('Capture requires a loaded on-device detector');
  const clip: DatasetClip = {
    schema_version: meta.schema_version, clip_id: meta.clip_id, session_id: meta.session_id,
    participant_id: meta.participant_id, exercise_id: meta.exercise_id, view: meta.view,
    camera_position: meta.camera_position, side: meta.side, context: meta.context,
    image: { width: meta.image.width, height: meta.image.height }, source: meta.source, model: meta.model,
    origin: meta.origin, consent: { reference: meta.consent.reference, version: meta.consent.version, allowed_use: meta.consent.allowed_use, purpose: meta.consent.purpose },
    status: 'recording', stop_reason: null, frames: [], annotations: [], suggestions: [],
  };
  assertClip(clip, [consent]);
  const started = now();
  let active = true, base: number | null = null, last: number | null = null;
  function snapshot() { return clone(clip); }
  function stop(reason: StopReason) {
    if (active) {
      active = false;
      clip.stop_reason = reason;
      clip.status = reason === 'manual' || reason === 'limit' ? 'complete' : 'incomplete';
    }
    return snapshot();
  }
  function tick() { if (active && now() - started >= 60_000) stop('limit'); }
  return {
    get active() { return active; }, snapshot, stop, tick,
    add(detection: Detection, poseNowMs: number) {
      tick();
      if (!active) return;
      const result = detection.result;
      if (result && (result.source !== clip.source || result.model !== clip.model)) { stop('mode_change'); return; }
      const timestamp = result?.timestamp_ms ?? poseNowMs;
      if (!Number.isFinite(timestamp) || (last !== null && timestamp <= last)) throw Error('Capture timestamps must increase');
      if (result && (!unit(result.score) || result.joints.length !== 17 || result.joints.some(j => !unit(j.x) || !unit(j.y) || !unit(j.c)))) throw Error('Invalid joint detection');
      base ??= timestamp;
      const relative = timestamp - base;
      if (relative > 60_000) { stop('camera_error'); return; }
      const frame: DatasetFrame = result ? { timestamp_ms: relative, score: result.score, joints: result.joints.map(j => ({ x: j.x, y: j.y, c: j.c })) } : { timestamp_ms: relative, absent: true };
      clip.frames.push(frame); last = timestamp;
    },
    addSuggestion(startPoseMs: number, closedPoseMs: number, ruleFlags: string[] = []) {
      if (base === null || !Number.isFinite(startPoseMs) || !Number.isFinite(closedPoseMs) || closedPoseMs < startPoseMs) return;
      const start = clip.frames.findIndex(f => f.timestamp_ms >= startPoseMs - base!);
      let end = clip.frames.findIndex(f => f.timestamp_ms > closedPoseMs - base!);
      if (end < 0) end = clip.frames.length;
      if (start >= 0 && end > start) {
        // A closing frame can simultaneously start the next attempt. Its source sample
        // belongs to the new interval, rather than being duplicated between reps.
        const previous = clip.suggestions.at(-1);
        if (previous && previous.end_frame > start) {
          previous.end_frame = start;
          if (previous.end_frame <= previous.start_frame) clip.suggestions.pop();
        }
        clip.suggestions.push({ start_frame: start, end_frame: end, rule_flags: [...ruleFlags] });
      }
    },
  };
}
