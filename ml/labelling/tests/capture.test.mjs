import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCapture } from '../src/capture.ts';
import { createDraftRepository } from '../src/repository.ts';
import { validateClip } from '../src/validate.ts';

const consent = { reference: 'consent-1', participant_id: 'p1', version: 'joint-capture-v1', granted_at: '2026-10-10T12:00:00Z', purpose: 'private_model_development', status: 'active', publication_allowed: false };
const meta = { schema_version: 1, clip_id: 'clip-1', session_id: 's1', participant_id: 'p1', exercise_id: 'squat', view: 'side', camera_position: 'back', side: 'bilateral', context: 'standard', image: { width: 1080, height: 1920 }, source: 'coreml', model: 'yolov8n-pose-320', origin: 'recorded', consent: { reference: 'consent-1', version: 'joint-capture-v1', allowed_use: true, purpose: 'private_model_development' } };
const pose = timestamp_ms => ({ result: { timestamp_ms, score: .912345, source: 'coreml', model: meta.model, joints: Array.from({ length: 17 }, () => ({ x: .123456789, y: .6, c: .912345 })) } });
function memory() { const data = new Map(); return { data, read: async n => data.get(n) ?? null, write: async (n, t) => { data.set(n, t); }, list: async () => [...data.keys()], remove: async n => { data.delete(n); } }; }

test('start requires active matching consent, dimensions and on-device detector', () => {
  assert.throws(() => createCapture(meta, { ...consent, status: 'withdrawn' }));
  assert.throws(() => createCapture(meta, { ...consent, participant_id: 'other' }));
  assert.throws(() => createCapture({ ...meta, image: { width: 0, height: 1920 } }, consent));
  assert.throws(() => createCapture({ ...meta, source: 'cloud' }, consent));
  assert.throws(() => createCapture({ ...meta, model: '' }, consent));
  assert.throws(() => createCapture(meta, { ...consent, publication_allowed: true }));
  assert.throws(() => createCapture(meta, { ...consent, granted_at: 'yesterday' }));
  assert.throws(() => createCapture(meta, { ...consent, status: 'unknown' }));
  assert.throws(() => createCapture({ ...meta, image: { width: 1080.5, height: 1920 } }, consent));
});
test('raw samples, absence timestamps, cloned locks, closure tail and late callbacks', () => {
  const input = structuredClone(meta); const c = createCapture(input, consent, () => 0);
  input.exercise_id = 'lunge'; input.image.width = 1;
  c.add(pose(1000), 1000); c.add({ result: undefined }, 1100); c.add(pose(1200), 1200);
  c.addSuggestion(1000, 1200, ['partial_range']);
  const clip = c.stop('manual');
  assert.equal(clip.exercise_id, 'squat'); assert.equal(clip.image.width, 1080);
  assert.equal(clip.frames[0].joints[0].x, .123456789);
  assert.deepEqual(clip.frames.map(f => f.timestamp_ms), [0, 100, 200]);
  assert.deepEqual(clip.suggestions, [{ start_frame: 0, end_frame: 3, rule_flags: ['partial_range'] }]);
  c.add(pose(1300), 1300); clip.frames.length = 0;
  assert.equal(c.snapshot().frames.length, 3); assert.equal(c.active, false);
});
test('wall cap works without detections and callback guard enforces limit', () => {
  let now = 0; const c = createCapture(meta, consent, () => now); now = 60000; c.tick();
  assert.equal(c.active, false); assert.equal(c.snapshot().stop_reason, 'limit');
  now = 0; const second = createCapture(meta, consent, () => now); second.add(pose(1000), 1000); now = 60001; second.add(pose(61001), 61001);
  assert.equal(second.snapshot().frames.length, 1);
});
test('interruption, source/model change and retry remain independent', () => {
  const c = createCapture(meta, consent); c.add(pose(1000), 1000);
  c.add({ result: { ...pose(1100).result, source: 'vision' } }, 1100);
  assert.equal(c.snapshot().status, 'incomplete'); assert.equal(c.snapshot().stop_reason, 'mode_change');
  const retry = createCapture({ ...meta, clip_id: 'retry' }, consent); assert.equal(retry.snapshot().frames.length, 0);
  assert.equal(retry.stop('background').status, 'incomplete');
});
test('privacy allowlist and invalid/out-of-order detections are rejected', () => {
  const c = createCapture(meta, consent); const d = pose(1000); d.result.image = 'secret'; c.add(d, 1000);
  assert.equal('image' in c.snapshot().frames[0], false);
  assert.throws(() => c.add(pose(999), 999));
  const bad = pose(1100); bad.result.joints[0].x = NaN; assert.throws(() => c.add(bad, 1100));
});
test('reopened repository restores recording as interrupted and annotations persist', async () => {
  const storage = memory(); const c = createCapture(meta, consent); c.add(pose(1000), 1000);
  await createDraftRepository(storage).save(c.snapshot());
  const [restored] = await createDraftRepository(storage).list();
  assert.equal(restored.status, 'incomplete'); assert.equal(restored.stop_reason, 'recovered');
  const complete = c.stop('manual'); complete.annotations = [{ rep_id: 'r1', start_frame: 0, end_frame: 1, state: 'discard', human_labels: [], primary_label: null, reviewer_id: 'p1', reviewed_at: consent.granted_at, boundary_provenance: 'manual', revision: 1 }];
  await createDraftRepository(storage).save(complete);
  assert.deepEqual((await createDraftRepository(storage).list())[0].annotations, complete.annotations);
});
test('only two verified revisions retained; interrupted pruning preserves last-good fallback', async () => {
  const storage = memory(); const repo = createDraftRepository(storage); const c = createCapture(meta, consent); c.add(pose(1000), 1000);
  await repo.save(c.snapshot()); c.add(pose(1100), 1100); await repo.save(c.snapshot()); c.add(pose(1200), 1200); await repo.save(c.snapshot());
  const names = () => [...storage.data.keys()].filter(n => n.startsWith('labelling-draft-')).sort();
  assert.equal(names().length, 2);
  storage.remove = async () => { throw Error('interrupted pruning'); };
  c.add(pose(1300), 1300); await repo.save(c.snapshot());
  assert.equal((await createDraftRepository(storage).list())[0].frames.length, 4);
  storage.data.set(names().at(-1), 'truncated');
  assert.equal((await createDraftRepository(storage).list())[0].frames.length, 3);
});
test('repository rejects malformed snapshots but saves empty recording drafts', async () => {
  const storage = memory(); const repo = createDraftRepository(storage); const empty = createCapture(meta, consent).snapshot();
  await repo.save(empty); assert.equal((await repo.list())[0].frames.length, 0);
  await assert.rejects(repo.save({ ...empty, image: { width: 1.2, height: 1920 } }));
});
test('old capture callback after retry never enters the new session', () => {
  const old = createCapture(meta, consent); old.add(pose(1000), 1000); old.stop('camera_error');
  const retry = createCapture({ ...meta, clip_id: 'retry' }, consent); retry.add(pose(2000), 2000);
  old.add(pose(2100), 2100);
  assert.equal(old.snapshot().frames.length, 1); assert.equal(retry.snapshot().frames.length, 1);
});
test('shared closure/start frame belongs once and both suggested reps can be accepted', () => {
  const c = createCapture(meta, consent, () => 0);
  for (const time of [1000,1100,1200,1300,1400]) { const d=pose(time); d.result.joints[0].x += (time-1000)/1000; c.add(d,time); }
  c.addSuggestion(1000,1200); c.addSuggestion(1200,1400);
  const clip=c.stop('manual');
  assert.deepEqual(clip.suggestions.map(s=>[s.start_frame,s.end_frame]),[[0,2],[2,5]]);
  clip.annotations=clip.suggestions.map((s,i)=>({rep_id:`r${i}`,start_frame:s.start_frame,end_frame:s.end_frame,state:'accepted',human_labels:['clean'],primary_label:'clean',reviewer_id:'p1',reviewed_at:consent.granted_at,boundary_provenance:'engine',revision:1}));
  assert.deepEqual(validateClip(clip,[consent]),[]);
});
test('pose clock jump beyond capture bounds stops incomplete without poisoning retained draft', () => {
  const c=createCapture(meta,consent,()=>0); c.add(pose(1000),1000); c.add(pose(61001),61001);
  const clip=c.snapshot(); assert.equal(c.active,false); assert.equal(clip.status,'incomplete'); assert.equal(clip.stop_reason,'camera_error');
  assert.equal(clip.frames.length,1); assert.deepEqual(validateClip(clip,[consent]),[]);
});
test('serialized revisions retain last good after truncated or failed writes', async () => {
  const storage = memory(); const repo = createDraftRepository(storage); const c = createCapture(meta, consent); c.add(pose(1000), 1000);
  await repo.save(c.stop('manual')); const originalWrite = storage.write;
  storage.write = async (n, t) => { await originalWrite(n, t.slice(0, 20)); };
  await assert.rejects(repo.save(c.snapshot()));
  assert.equal((await createDraftRepository(storage).list()).length, 1);
  storage.write = async () => { throw Error('disk full'); };
  await assert.rejects(repo.save(c.snapshot()));
  assert.equal((await createDraftRepository(storage).list())[0].frames.length, 1);
});
test('participant deletion tombstones old revisions and app-managed exports', async () => {
  const storage = memory(); const repo = createDraftRepository(storage); const c = createCapture(meta, consent); c.add(pose(1000), 1000);
  await repo.save(c.stop('manual')); const old = [...storage.data.entries()];
  await storage.write('labelling-export-p1-bundle.json', '{}');
  await repo.deleteParticipant('p1');
  for (const [n,t] of old) storage.data.set(n,t);
  assert.deepEqual(await createDraftRepository(storage).list(), []);
  assert.equal(storage.data.has('labelling-export-p1-bundle.json'), false);
  await assert.rejects(repo.save(c.snapshot()));
});
