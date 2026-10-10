// Model manifest on the Hugging Face Hub (CONN-10). Written by ml/pose_export/push_to_hub.py.

export interface ManifestFile {
  path: string; // relative to the repo root, e.g. "pose/yolov8n-pose-320.mlpackage/Manifest.json"
  size: number;
  md5: string;
}

export interface ManifestModel {
  format: 'coreml' | 'onnx';
  path: string; // a file, or an .mlpackage folder
  files: ManifestFile[];
  imgsz?: number;
}

export interface Manifest {
  schema: number;
  version: number; // goes up by one every publish
  published_at: string;
  models: Record<string, ManifestModel>;
}

/** The Core ML pose models the iPhone app uses. */
export const PHONE_MODELS = ['pose-320-coreml', 'pose-256-coreml'] as const;

export const SUPPORTED_SCHEMA = 1;

// Paths come from the network and are written to disk: no absolute paths or "..".
function isSafePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
}

/** True when the manifest has the shape this app version understands. */
export function isManifest(value: unknown): value is Manifest {
  const m = value as Manifest;
  return (
    !!m &&
    m.schema === SUPPORTED_SCHEMA &&
    Number.isInteger(m.version) &&
    typeof m.models === 'object' &&
    Object.values(m.models).every(
      (model) =>
        typeof model?.path === 'string' &&
        Array.isArray(model.files) &&
        model.files.every((f) => typeof f.md5 === 'string' && isSafePath(f.path) && f.path.startsWith(model.path)),
    )
  );
}

function sameFiles(a: ManifestModel, b: ManifestModel): boolean {
  if (a.files.length !== b.files.length) return false;
  const byPath = new Map(a.files.map((f) => [f.path, f.md5]));
  return b.files.every((f) => byPath.get(f.path) === f.md5);
}

/**
 * Which models to download: only when the Hub manifest is newer than what is installed, and
 * only the wanted models whose files actually changed (or that aren't installed yet).
 */
export function modelsToUpdate(remote: Manifest, installed: Manifest | null, wanted: readonly string[]): string[] {
  if (installed && remote.version <= installed.version) return [];
  return wanted.filter((name) => {
    const next = remote.models[name];
    if (!next) return false; // not published (yet)
    const current = installed?.models[name];
    return !current || !sameFiles(current, next);
  });
}

/** URL of a file in the Hub repo. */
export function hubFileUrl(repo: string, path: string, revision = 'main'): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
