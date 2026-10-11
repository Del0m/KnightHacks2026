import { EXERCISE_IDS, LABEL_VIEWS } from './contract.ts';
import type { ConsentRecord, DatasetClip, DatasetFrame } from './contract.ts';
const token = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit = (v: unknown) => finite(v) && v >= 0 && v <= 1;
const integer = (v: unknown) => finite(v) && Number.isInteger(v);
function date(v: unknown): boolean {
    if (typeof v !== 'string') return false;
    const match = iso.exec(v);
    if (!match) return false;
    const [, y, m, d, h, minute, second, zoneHour, zoneMinute] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
    if (Number(h) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
    if (zoneHour !== undefined && (Number(zoneHour) > 23 || Number(zoneMinute) > 59)) return false;
    return Number.isFinite(Date.parse(v));
}
function shape(v: unknown, keys: string[], path: string, errors: string[]): v is Record<string, unknown> {
    if (!object(v)) {
        errors.push(`${path}: expected object`);
        return false;
    }
    for (const k of keys)
        if (!Object.hasOwn(v, k))
            errors.push(`${path}.${k}: required`);
    for (const k of Object.keys(v))
        if (!keys.includes(k))
            errors.push(`${path}.${k}: unexpected field`);
    return true;
}
function id(v: unknown, path: string, errors: string[]) { if (typeof v !== 'string' || !token.test(v))
    errors.push(`${path}: invalid pseudonymous token`); }
function enumValue(v: unknown, options: readonly unknown[], path: string, errors: string[]) { if (!options.includes(v))
    errors.push(`${path}: invalid value`); }
export function validateConsent(value: unknown): string[] {
    const e: string[] = [];
    if (!shape(value, ['reference', 'participant_id', 'version', 'granted_at', 'purpose', 'status', 'publication_allowed'], 'consent', e))
        return e;
    id(value.reference, 'consent.reference', e);
    id(value.participant_id, 'consent.participant_id', e);
    enumValue(value.version, ['joint-capture-v1'], 'consent.version', e);
    enumValue(value.purpose, ['private_model_development'], 'consent.purpose', e);
    enumValue(value.status, ['active', 'withdrawn'], 'consent.status', e);
    if (value.publication_allowed !== false)
        e.push('consent.publication_allowed: must be false');
    if (!date(value.granted_at))
        e.push('consent.granted_at: expected ISO timestamp');
    return e;
}
function interval(v: Record<string, unknown>, n: number, path: string, e: string[]) {
    if (!integer(v.start_frame) || !integer(v.end_frame) || Number(v.start_frame) < 0 || Number(v.end_frame) > n || Number(v.start_frame) >= Number(v.end_frame))
        e.push(`${path}: invalid [start_frame,end_frame) interval`);
}
/** Acceptance requires at least two confident, changing joint samples and no unobservable gap >300ms. */
export function acceptedQualityErrors(frames: DatasetFrame[]): string[] {
    const e: string[] = [];
    if (frames.length < 2)
        return ['accepted rep: insufficient samples'];
    const poses = frames.filter((f): f is Extract<DatasetFrame, {
        joints: unknown;
    }> => !('absent' in f));
    if (poses.length < 2)
        return ['accepted rep: insufficient person observations'];
    if (poses[0].timestamp_ms - frames[0].timestamp_ms > 300 || frames.at(-1)!.timestamp_ms - poses.at(-1)!.timestamp_ms > 300)
        e.push('accepted rep: missing-person boundary gap over 300ms');
    for (let i = 1; i < poses.length; i++)
        if (poses[i].timestamp_ms - poses[i - 1].timestamp_ms > 300)
            e.push('accepted rep: missing-person/capture gap over 300ms');
    let motion = false;
    for (let i = 1; i < poses.length; i++)
        for (let j = 0; j < 17; j++) {
            const a = poses[i - 1].joints[j], b = poses[i].joints[j];
            if (a.c >= .3 && b.c >= .3 && Math.hypot(a.x - b.x, a.y - b.y) > 0.0001)
                motion = true;
        }
    if (!motion)
        e.push('accepted rep: no observable motion');
    return e;
}
export function validateClip(value: unknown, consents?: ConsentRecord[]): string[] {
    const e: string[] = [];
    const keys = ['schema_version', 'clip_id', 'session_id', 'participant_id', 'exercise_id', 'view', 'camera_position', 'side', 'context', 'image', 'source', 'model', 'origin', 'consent', 'status', 'stop_reason', 'frames', 'annotations', 'suggestions'];
    if (!shape(value, keys, 'clip', e))
        return e;
    enumValue(value.schema_version, [1], 'clip.schema_version', e);
    for (const k of ['clip_id', 'session_id', 'participant_id', 'model'])
        id(value[k], `clip.${k}`, e);
    enumValue(value.exercise_id, EXERCISE_IDS, 'clip.exercise_id', e);
    enumValue(value.view, ['front', 'side'], 'clip.view', e);
    enumValue(value.camera_position, ['front', 'back'], 'clip.camera_position', e);
    enumValue(value.side, ['left', 'right', 'bilateral'], 'clip.side', e);
    enumValue(value.context, ['standard', 'modified', 'prescribed'], 'clip.context', e);
    enumValue(value.source, ['coreml', 'vision'], 'clip.source', e);
    enumValue(value.origin, ['recorded', 'synthetic'], 'clip.origin', e);
    enumValue(value.status, ['recording', 'complete', 'incomplete'], 'clip.status', e);
    enumValue(value.stop_reason, ['manual', 'limit', 'background', 'camera_error', 'mode_change', 'recovered', null], 'clip.stop_reason', e);
    if (value.status === 'recording' && value.stop_reason !== null)
        e.push('clip.stop_reason: recording requires null');
    if (value.status !== 'recording' && value.stop_reason === null)
        e.push('clip.stop_reason: stopped capture requires reason');
    if (shape(value.image, ['width', 'height'], 'clip.image', e))
        for (const k of ['width', 'height'])
            if (!integer(value.image[k]) || Number(value.image[k]) <= 0)
                e.push(`clip.image.${k}: positive integer required`);
    if (shape(value.consent, ['reference', 'version', 'allowed_use', 'purpose'], 'clip.consent', e)) {
        id(value.consent.reference, 'clip.consent.reference', e);
        enumValue(value.consent.version, ['joint-capture-v1'], 'clip.consent.version', e);
        enumValue(value.consent.purpose, ['private_model_development'], 'clip.consent.purpose', e);
        if (value.consent.allowed_use !== true)
            e.push('clip.consent.allowed_use: consent required');
        if (consents) {
            const reference = value.consent.reference;
            const matches = consents.filter(c => c.reference === reference);
            const c = matches[0];
            if (matches.length !== 1 || !c || validateConsent(c).length || c.status !== 'active' || c.participant_id !== value.participant_id)
                e.push('clip.consent: active matching local consent evidence required');
        }
    }
    let validFrames = true;
    if (!Array.isArray(value.frames) || value.frames.length > 14400) {
        e.push('clip.frames: expected array, maximum 14400');
        validFrames = false;
    }
    else {
        let previous = -1;
        value.frames.forEach((f: unknown, i: number) => {
            const before = e.length, p = `clip.frames[${i}]`;
            if (!object(f)) {
                e.push(`${p}: expected object`);
                validFrames = false;
                return;
            }
            shape(f, f.absent === true ? ['timestamp_ms', 'absent'] : ['timestamp_ms', 'score', 'joints'], p, e);
            if (!finite(f.timestamp_ms) || f.timestamp_ms < 0 || f.timestamp_ms > 60000 || f.timestamp_ms <= previous)
                e.push(`${p}.timestamp_ms: strictly increasing within 0..60000 required`);
            else
                previous = f.timestamp_ms;
            if (f.absent !== true) {
                if (!unit(f.score))
                    e.push(`${p}.score: unit confidence required`);
                if (!Array.isArray(f.joints) || f.joints.length !== 17)
                    e.push(`${p}.joints: exactly 17 required`);
                else
                    f.joints.forEach((j: unknown, k: number) => { if (shape(j, ['x', 'y', 'c'], `${p}.joints[${k}]`, e))
                        for (const n of ['x', 'y', 'c'])
                            if (!unit(j[n]))
                                e.push(`${p}.joints[${k}].${n}: finite unit value required`); });
            }
            if (e.length > before)
                validFrames = false;
        });
    }
    const n = Array.isArray(value.frames) ? value.frames.length : 0;
    const intervals: [
        number,
        number
    ][] = [];
    const ids = new Set<string>();
    if (!Array.isArray(value.annotations))
        e.push('clip.annotations: expected array');
    else
        value.annotations.forEach((a: unknown, i: number) => {
            const p = `clip.annotations[${i}]`;
            if (!shape(a, ['rep_id', 'start_frame', 'end_frame', 'state', 'human_labels', 'primary_label', 'reviewer_id', 'reviewed_at', 'boundary_provenance', 'revision'], p, e))
                return;
            id(a.rep_id, `${p}.rep_id`, e);
            id(a.reviewer_id, `${p}.reviewer_id`, e);
            if (ids.has(String(a.rep_id)))
                e.push(`${p}.rep_id: duplicate`);
            ids.add(String(a.rep_id));
            if (a.state === 'accepted' && value.status === 'recording')
                e.push(`${p}: accepted annotation requires stopped capture`);
            if (a.state === 'accepted' && value.context === 'prescribed')
                e.push(`${p}: prescribed context requires uncertain/discard review`);
            interval(a, n, p, e);
            enumValue(a.state, ['accepted', 'uncertain', 'discard'], `${p}.state`, e);
            enumValue(a.boundary_provenance, ['manual', 'engine', 'engine_adjusted'], `${p}.boundary_provenance`, e);
            if (!integer(a.revision) || Number(a.revision) < 1)
                e.push(`${p}.revision: positive integer required`);
            if (!date(a.reviewed_at))
                e.push(`${p}.reviewed_at: ISO timestamp required`);
            if (!Array.isArray(a.human_labels) || !a.human_labels.every(l => typeof l === 'string') || new Set(a.human_labels).size !== a.human_labels.length)
                e.push(`${p}.human_labels: unique strings required`);
            else {
                const map = LABEL_VIEWS[value.exercise_id as keyof typeof LABEL_VIEWS];
                for (const l of a.human_labels)
                    if (!map || !Object.hasOwn(map, l) || (map[l] !== 'any' && map[l] !== value.view))
                        e.push(`${p}.human_labels: label ${l} incompatible with exercise/view`);
                if (a.human_labels.includes('clean') && a.human_labels.length !== 1)
                    e.push(`${p}: clean excludes error labels`);
                if (a.primary_label !== null && !a.human_labels.includes(a.primary_label as string))
                    e.push(`${p}.primary_label: must be observed human label`);
                if (a.state === 'accepted' && (a.human_labels.length === 0 || a.primary_label === null))
                    e.push(`${p}: accepted requires human primary label`);
            }
            if (a.primary_label !== null && typeof a.primary_label !== 'string')
                e.push(`${p}.primary_label: string or null required`);
            if (integer(a.start_frame) && integer(a.end_frame) && Number(a.start_frame) >= 0 && Number(a.end_frame) <= n && Number(a.start_frame) < Number(a.end_frame)) {
                intervals.push([Number(a.start_frame), Number(a.end_frame)]);
                if (a.state === 'accepted' && validFrames)
                    e.push(...acceptedQualityErrors((value.frames as DatasetFrame[]).slice(Number(a.start_frame), Number(a.end_frame))).map(x => `${p}: ${x}`));
            }
        });
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++)
        if (intervals[i][0] < intervals[i - 1][1])
            e.push('clip.annotations: overlapping intervals');
    if (!Array.isArray(value.suggestions))
        e.push('clip.suggestions: expected array');
    else
        value.suggestions.forEach((s: unknown, i: number) => { const p = `clip.suggestions[${i}]`; if (shape(s, ['start_frame', 'end_frame', 'rule_flags'], p, e)) {
            interval(s, n, p, e);
            if (!Array.isArray(s.rule_flags) || !s.rule_flags.every(v => typeof v === 'string' && token.test(v)))
                e.push(`${p}.rule_flags: safe rule tokens required`);
        } });
    return e;
}
export function assertClip(value: unknown, consents?: ConsentRecord[]): asserts value is DatasetClip { const e = validateClip(value, consents); if (e.length)
    throw new Error(e.join('\n')); }
export function assertCollection(clips: unknown[], consents?: ConsentRecord[]): asserts clips is DatasetClip[] {
    const clipIds = new Set<string>(), repIds = new Set<string>(), sources = new Set<string>();
    for (const clip of clips) {
        assertClip(clip, consents);
        if (clipIds.has(clip.clip_id))
            throw new Error('duplicate clip_id');
        clipIds.add(clip.clip_id);
        for (const a of clip.annotations) {
            if (repIds.has(a.rep_id))
                throw new Error('duplicate rep_id');
            repIds.add(a.rep_id);
            const key = `${clip.clip_id}:${a.start_frame}:${a.end_frame}`;
            if (sources.has(key))
                throw new Error('duplicate source interval');
            sources.add(key);
        }
    }
}
