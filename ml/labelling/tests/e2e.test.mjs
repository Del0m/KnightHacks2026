import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCapture } from '../src/capture.ts';
import { saveAnnotation } from '../src/annotation.ts';
import { createDraftRepository } from '../src/repository.ts';
import { createBundle, importBundle } from '../src/export.ts';
import { coverage } from '../src/coverage.ts';
import { EXERCISE_IDS } from '../src/contract.ts';
import { fixture, annotation } from './fixtures.mjs';

const consent = {
  reference: 'consent-a', participant_id: 'self', version: 'joint-capture-v1',
  granted_at: '2026-10-10T18:00:00Z', purpose: 'private_model_development',
  status: 'active', publication_allowed: false,
};
const digest = async text => createHash('sha256').update(text).digest('hex');
function memoryStorage() {
  const files = new Map();
  return {
    files,
    read: async name => files.get(name) ?? null,
    write: async (name, text) => { files.set(name, text); },
    list: async () => [...files.keys()],
    remove: async name => { files.delete(name); },
  };
}

// All observations in this test file are generated test inputs. They are never collection evidence.
// Origin defaults to synthetic; only the numerical coverage test explicitly models recorded inputs.
function capturedTestClip(id, exercise = 'squat', origin = 'synthetic') {
  const source = fixture();
  const { frames, annotations, suggestions, status, stop_reason, ...meta } = source;
  let clock = 10_000;
  const capture = createCapture({ ...meta, clip_id: id, exercise_id: exercise, origin }, consent, () => clock);
  for (const frame of frames) {
    clock = 10_000 + frame.timestamp_ms;
    capture.add({ result: { ...frame, timestamp_ms: clock, source: meta.source, model: meta.model } }, clock);
  }
  // No engine suggestion exists: the manually annotated attempt is independent of rep counting.
  const stopped = capture.stop('manual');
  return saveAnnotation(stopped, {
    ...annotation(), rep_id: `rep-${id}`, human_labels: ['clean'], primary_label: 'clean',
  });
}

test('consent → raw capture → manual review → reopened draft → export/import → withdrawal', async () => {
  const storage = memoryStorage();
  const reviewed = capturedTestClip('pilot-test');
  assert.equal(reviewed.origin, 'synthetic');
  assert.equal(reviewed.suggestions.length, 0);
  assert.deepEqual(reviewed.frames.map(frame => frame.timestamp_ms), [0, 50, 200]);
  assert.equal(reviewed.annotations[0].boundary_provenance, 'manual');
  const edited = saveAnnotation(reviewed, {
    ...reviewed.annotations[0], start_frame: 1, boundary_provenance: 'engine_adjusted',
  });
  assert.equal(edited.annotations[0].revision, 2);
  await createDraftRepository(storage).save(edited);
  const reopened = await createDraftRepository(storage).list();
  assert.deepEqual(reopened, [edited]);

  const bundle = await createBundle(reopened, [consent], digest);
  assert.equal(bundle.manifest.checksums.clips_jsonl.length, 64);
  assert.equal(bundle.training_jsonl, '');
  assert.equal(bundle.manifest.counts.total, 0);
  assert.equal(bundle.manifest.counts.complete, false);
  const imported = await importBundle(JSON.parse(JSON.stringify(bundle)), [consent], digest);
  assert.deepEqual(imported[0].frames, edited.frames);
  assert.deepEqual(imported[0].annotations, edited.annotations);
  assert.deepEqual(coverage(imported, [consent]), bundle.manifest.counts);

  await storage.write('labelling-export-all-pilot.json', JSON.stringify(bundle));
  await createDraftRepository(storage).deleteParticipant('self');
  const afterDelete = await createDraftRepository(storage).list();
  assert.deepEqual(afterDelete, []);
  assert.equal(storage.files.has('labelling-export-all-pilot.json'), false);
  const withdrawn = { ...consent, status: 'withdrawn' };
  const regenerated = await createBundle(afterDelete, [withdrawn], digest);
  assert.equal(regenerated.manifest.counts.total, 0);
  assert.equal(regenerated.clips_jsonl, '');
  assert.equal(regenerated.training_jsonl, '');
  assert.deepEqual(regenerated.manifest.consents, []);
  await assert.rejects(importBundle(bundle, [withdrawn], digest), /active matching local consent/);
  await assert.rejects(createDraftRepository(storage).save(edited), /Participant was deleted/);
});

test('TEST-ONLY recorded coverage fixture passes 40 each, fails 39 despite more than 200, and exports reviewed tensors', async () => {
  // The recorded origin here exercises numerical gates; these are generated TEST fixtures,
  // not a collected dataset, and neither this test nor its output satisfies the real 200-rep issue.
  const clips = EXERCISE_IDS.flatMap(exercise => Array.from({ length: 40 }, (_, i) =>
    capturedTestClip(`coverage-${exercise}-${i}`, exercise, 'recorded')));
  const bundle = await createBundle(clips, [consent], digest);
  assert.equal(bundle.manifest.counts.complete, true);
  assert.equal(bundle.manifest.counts.total, 200);
  assert.deepEqual(Object.values(bundle.manifest.counts.by_exercise), [40, 40, 40, 40, 40]);
  const rows = bundle.training_jsonl.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 200);
  assert.equal(rows[0].joints.length, 32);
  assert.equal(rows[0].joints[0].length, 17);
  assert.equal(rows[0].joints[0][0].length, 2);
  assert.equal(rows[0].validity.length, 32);
  const imported = await importBundle(bundle, [consent], digest);
  assert.equal(coverage(imported, [consent]).complete, true);
  await assert.rejects(importBundle(bundle, [consent], digest, imported), /duplicate clip_id/);

  const deficient = clips.filter(clip => clip.clip_id !== 'coverage-lunge-39');
  deficient.push(capturedTestClip('extra-squat-0', 'squat', 'recorded'));
  deficient.push(capturedTestClip('extra-squat-1', 'squat', 'recorded'));
  const failed = await createBundle(deficient, [consent], digest);
  assert.equal(failed.manifest.counts.total, 201);
  assert.equal(failed.manifest.counts.complete, false);
  assert.equal(failed.manifest.counts.by_exercise.lunge, 39);
  assert.equal(failed.manifest.counts.deficits.lunge, 1);
});
