import { createSetRecorder } from '@/engine/setRecord';
import { createFormEngine } from '@/engine/engine';
import { createSetRules } from '@/engine/rules';
import { cameraSpec } from '../exercises';
import { setFeedback } from '../setRecord';
import clip from '@/engine/__fixtures__/bicep_curl_clean.json';
import type { PoseResult } from '@/pose/types';
it('packages real counted reps and rule flags without inventing model quality', () => {
  const spec = cameraSpec('curl'), engine = createFormEngine(spec), rules = createSetRules(spec), capture = createSetRecorder(spec, { setIndex: 2 });
  for (const frame of clip.frames) { capture.pose(frame as PoseResult); for (const event of engine.push(frame as PoseResult).events) { capture.event(event); rules.handle(event); } }
  const end = engine.endSet(clip.frames[clip.frames.length - 1].timestamp_ms + 1000);
  let summary;
  for (const event of end.events) { capture.event(event); const result = rules.handle(event); if (result?.type === 'set_flags') summary = result.set; }
  expect(summary).toBeDefined();
  const record = capture.finish(summary!);
  expect(record.schema_version).toBe(1); expect(record.set_index).toBe(2); expect(record.frames.length).toBeGreaterThan(0);
  expect(record.reps.length).toBeGreaterThan(0);
  expect(record.reps).toHaveLength(summary!.total_reps);
  for (const rep of record.reps) { expect(rep.tempo_ms).toBeGreaterThan(0); expect(rep.quality).toBeNull(); expect(rep.start_ms).toBeGreaterThanOrEqual(0); expect(rep.end_ms! - rep.start_ms!).toBe(rep.tempo_ms); }
  expect(record.reps.filter(r => !r.flags.length)).toHaveLength(summary!.clean_reps);
  expect(setFeedback(spec, summary!).note).toContain('good');
});
it('uses at most the highest-priority improvement and never rewards an empty set', () => {
  const spec = cameraSpec('curl');
  const summary = { exercise_id: spec.id, total_reps: 0, clean_reps: 0, flags: [], reps: [], rules: [], top: null, reason: 'manual', extra_notes: [] } as any;
  expect(setFeedback(spec, summary).medal).toBe('bronze');
});
