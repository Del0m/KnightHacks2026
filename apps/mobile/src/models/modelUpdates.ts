// CONN-10: on launch, check the Hub for newer pose models and download them (Architecture §5).
//
//   checkForModelUpdates()      call once on launch; never throws, never blocks the UI
//   downloadedModelUri(name)    local .mlpackage folder for a model, or null to use the bundled one
//
// Files land in <documents>/models/current/<path from the manifest>. A download goes to a
// staging folder first and every file's md5 is checked before anything is swapped in, so a
// failed or partial download leaves the installed models untouched.
//
// Stub until AI engineer A wires it up: the native pose detector (modules/steadyforum-pose) only
// loads the models bundled at build time. To use a download it needs something like
// createPoseDetectorFromPath(uri), which compiles the .mlpackage with MLModel.compileModel(at:)
// (and caches the .mlmodelc). Until then downloads are stored and ready, but not yet used.

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { PHONE_MODELS, hubFileUrl, isManifest, modelsToUpdate, type Manifest } from './manifest';

export const MODEL_REPO = 'bubblesmal/steadyforum-models';

export interface UpdateResult {
  status: 'up-to-date' | 'updated' | 'skipped' | 'failed';
  version?: number;
  models?: string[];
  error?: string;
}

const root = () => new Directory(Paths.document, 'models');
const installedManifestFile = () => new File(root(), 'installed.json');

function pathIn(base: Directory, relative: string): File {
  return new File(base, ...relative.split('/'));
}

async function readInstalled(): Promise<Manifest | null> {
  const file = installedManifestFile();
  if (!file.exists) return null;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchRemote(repo: string, timeoutMs: number): Promise<Manifest> {
  const res = await fetch(hubFileUrl(repo, 'manifest.json'), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isManifest(body)) throw new Error('manifest has an unsupported format');
  return body;
}

/** Local folder of a downloaded model, or null when the app should use its bundled copy. */
export async function downloadedModelUri(name: string): Promise<string | null> {
  const installed = await readInstalled();
  const model = installed?.models[name];
  if (!model) return null;
  const current = new Directory(root(), 'current');
  const complete = model.files.every((f) => pathIn(current, f.path).exists);
  if (!complete) return null;
  return model.files.length === 1 && model.files[0].path === model.path
    ? pathIn(current, model.path).uri
    : new Directory(current, ...model.path.split('/')).uri;
}

/** Checks the Hub and downloads newer phone models. Never throws. */
export async function checkForModelUpdates(
  options: { repo?: string; models?: readonly string[]; timeoutMs?: number } = {},
): Promise<UpdateResult> {
  if (Platform.OS !== 'ios') return { status: 'skipped' }; // Core ML models are iPhone-only
  const repo = options.repo ?? MODEL_REPO;
  const wanted = options.models ?? PHONE_MODELS;
  let staging: Directory | null = null;

  try {
    const [remote, installed] = await Promise.all([fetchRemote(repo, options.timeoutMs ?? 10_000), readInstalled()]);
    const names = modelsToUpdate(remote, installed, wanted);
    if (names.length === 0) return { status: 'up-to-date', version: installed?.version ?? remote.version };

    staging = new Directory(root(), `staging-${remote.version}`);
    if (staging.exists) staging.delete();
    staging.create({ intermediates: true });

    // 1. Download every file of every changed model into staging, checking md5s.
    for (const name of names) {
      for (const f of remote.models[name].files) {
        const target = pathIn(staging, f.path);
        target.parentDirectory.create({ intermediates: true, idempotent: true });
        await File.downloadFileAsync(hubFileUrl(repo, f.path), target, { idempotent: true });
        const { md5 } = target.info({ md5: true });
        if (md5 !== f.md5) throw new Error(`${f.path}: checksum mismatch`);
      }
    }

    // 2. Swap the verified models into place, then record the new manifest last.
    const current = new Directory(root(), 'current');
    current.create({ intermediates: true, idempotent: true });
    for (const name of names) {
      const path = remote.models[name].path;
      const isFile = remote.models[name].files.length === 1 && remote.models[name].files[0].path === path;
      const from = isFile ? pathIn(staging, path) : new Directory(staging, ...path.split('/'));
      const to = isFile ? pathIn(current, path) : new Directory(current, ...path.split('/'));
      if (to.exists) to.delete();
      to.parentDirectory.create({ intermediates: true, idempotent: true });
      from.move(to.parentDirectory); // same name in staging and current, so this lands at `to`
    }

    const merged: Manifest = {
      ...remote,
      models: Object.fromEntries(
        wanted
          .map((name) => [name, names.includes(name) ? remote.models[name] : installed?.models[name]] as const)
          .filter((entry): entry is [string, Manifest['models'][string]] => !!entry[1]),
      ),
    };
    installedManifestFile().write(JSON.stringify(merged));
    return { status: 'updated', version: remote.version, models: names };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (staging?.exists) staging.delete();
  }
}
