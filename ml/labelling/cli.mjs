#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateConsent } from './src/validate.ts';
import { validateBundle, importBundle, createBundle } from './src/export.ts';
import { coverage } from './src/coverage.ts';

const usage = `Node 25 local joint dataset tools:
  node ml/labelling/cli.mjs validate <bundle.json> --consents <private-consents.json>
  node ml/labelling/cli.mjs unpack <bundle.json> --consents <private-consents.json> --out <new-folder>
  node ml/labelling/cli.mjs merge <bundle1.json> <bundle2.json> [...] --consents <private-consents.json> --out <new-bundle.json>
Private --consents evidence is required. Outputs must not exist. No uploads occur.`;
const digest = async text => createHash('sha256').update(text, 'utf8').digest('hex');
async function json(path) { return JSON.parse(await readFile(resolve(path), 'utf8')); }

async function main(args) {
  const command = args.shift();
  if (command === '--help' || command === '-h') { console.log(usage); return; }
  const files = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!['--consents', '--out'].includes(arg) || options[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid arguments\n' + usage);
      options[arg] = args[++i];
    } else files.push(arg);
  }
  if (!options['--consents']) throw Error('Trusted validation requires --consents private evidence\n' + usage);
  if (!['validate', 'unpack', 'merge'].includes(command) || (command === 'merge' ? files.length < 2 : files.length !== 1) || (command !== 'validate' && !options['--out']) || (command === 'validate' && options['--out'])) throw Error('Invalid arguments\n' + usage);
  const consents = await json(options['--consents']);
  if (!Array.isArray(consents) || !consents.length) throw Error('Private consent evidence must be a nonempty JSON array');
  const references = new Set();
  for (const consent of consents) {
    const errors = validateConsent(consent);
    if (errors.length) throw Error('Invalid private consent evidence: ' + errors.join('; '));
    if (references.has(consent.reference)) throw Error('Duplicate private consent reference');
    references.add(consent.reference);
  }
  const first = await json(files[0]);
  let clips = await validateBundle(first, consents, digest);
  if (command === 'merge') {
    for (const file of files.slice(1)) clips.push(...await importBundle(await json(file), consents, digest, clips));
    const bundle = await createBundle(clips, consents, digest);
    await writeFile(resolve(options['--out']), JSON.stringify(bundle) + '\n', { flag: 'wx' });
  } else if (command === 'unpack') {
    const directory = resolve(options['--out']);
    // Requiring a new folder prevents overwriting any existing user content.
    await mkdir(directory);
    try {
      await writeFile(join(directory, 'clips.jsonl'), first.clips_jsonl, { flag: 'wx' });
      await writeFile(join(directory, 'training.jsonl'), first.training_jsonl, { flag: 'wx' });
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(first.manifest, null, 2) + '\n', { flag: 'wx' });
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  console.log(JSON.stringify(coverage(clips, consents), null, 2));
}
try { await main(process.argv.slice(2)); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
