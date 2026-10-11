import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture, annotation } from './fixtures.mjs';
import { createBundle } from '../src/export.ts';
const cli = resolve('ml/labelling/cli.mjs');
const consents = [{ reference:'consent-a', participant_id:'self', version:'joint-capture-v1', granted_at:'2026-10-10T18:00:00Z', purpose:'private_model_development', status:'active', publication_allowed:false }];
const digest = async t => createHash('sha256').update(t).digest('hex');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding:'utf8' });
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'labelling-cli-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const clip = fixture(); clip.annotations=[annotation()]; const bundle=JSON.parse(JSON.stringify(await createBundle([clip],consents,digest)));
  const input=join(dir,'bundle.json'), evidence=join(dir,'consents.json');
  await writeFile(input,JSON.stringify(bundle)); await writeFile(evidence,JSON.stringify(consents));
  return {dir,input,evidence,bundle};
}
test('validate reports trusted coverage; unpack writes exact bytes and refuses overwrite', async t => {
  const {dir,input,evidence,bundle}=await setup(t);
  const valid=run('validate',input,'--consents',evidence); assert.equal(valid.status,0,valid.stderr);
  const report=JSON.parse(valid.stdout); assert.equal(report.total,1); assert.equal(report.complete,false); assert.equal(report.by_exercise.squat,1);
  const out=join(dir,'out'); const unpack=run('unpack',input,'--consents',evidence,'--out',out); assert.equal(unpack.status,0,unpack.stderr);
  assert.equal(await readFile(join(out,'clips.jsonl'),'utf8'),bundle.clips_jsonl);
  assert.equal(await readFile(join(out,'training.jsonl'),'utf8'),bundle.training_jsonl);
  assert.deepEqual(JSON.parse(await readFile(join(out,'manifest.json'),'utf8')),bundle.manifest);
  assert.notEqual(run('unpack',input,'--consents',evidence,'--out',out).status,0);
});
test('missing, malformed and withdrawn private evidence cannot validate', async t => {
  const {input,evidence}=await setup(t);
  const missing=run('validate',input); assert.notEqual(missing.status,0); assert.match(missing.stderr,/--consents/);
  await writeFile(evidence,JSON.stringify([{...consents[0],publication_allowed:true}])); assert.notEqual(run('validate',input,'--consents',evidence).status,0);
  await writeFile(evidence,JSON.stringify([{...consents[0],status:'withdrawn'}])); assert.notEqual(run('validate',input,'--consents',evidence).status,0);
});
test('merge rejects duplicate clips and can merge independent reviewed sources offline', async t => {
  const {dir,input,evidence}=await setup(t); const out=join(dir,'merged.json');
  const duplicate=run('merge',input,input,'--consents',evidence,'--out',out); assert.notEqual(duplicate.status,0); assert.match(duplicate.stderr,/duplicate/);
  const clip=fixture(); clip.clip_id='second'; clip.annotations=[{...annotation(),rep_id:'second-rep'}];
  const second=join(dir,'second.json'); await writeFile(second,JSON.stringify(await createBundle([clip],consents,digest)));
  const merged=run('merge',input,second,'--consents',evidence,'--out',out); assert.equal(merged.status,0,merged.stderr);
  assert.equal(JSON.parse(merged.stdout).total,2); assert.equal(run('validate',out,'--consents',evidence).status,0);
  assert.notEqual(run('merge',input,second,'--consents',evidence,'--out',out).status,0);
});
