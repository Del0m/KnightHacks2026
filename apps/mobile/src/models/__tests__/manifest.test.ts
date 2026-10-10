import { hubFileUrl, isManifest, modelsToUpdate, type Manifest } from '../manifest';

const pose = (md5: string) => ({
  format: 'coreml' as const,
  path: 'pose/yolov8n-pose-320.mlpackage',
  files: [
    { path: 'pose/yolov8n-pose-320.mlpackage/Manifest.json', size: 10, md5: `a${md5}` },
    { path: 'pose/yolov8n-pose-320.mlpackage/Data/weights.bin', size: 99, md5 },
  ],
});
const manifest = (version: number, md5 = 'x'): Manifest => ({
  schema: 1,
  version,
  published_at: '2026-10-10T00:00:00Z',
  models: { 'pose-320-coreml': pose(md5) },
});

describe('isManifest', () => {
  it('accepts what push_to_hub.py writes', () => {
    expect(isManifest(manifest(1))).toBe(true);
  });

  it('rejects an unknown schema', () => {
    expect(isManifest({ ...manifest(1), schema: 2 })).toBe(false);
  });

  it('rejects paths that could escape the models folder', () => {
    const bad = manifest(1);
    bad.models['pose-320-coreml'].files[0].path = 'pose/yolov8n-pose-320.mlpackage/../../../evil';
    expect(isManifest(bad)).toBe(false);
    bad.models['pose-320-coreml'].files[0].path = '/etc/passwd';
    expect(isManifest(bad)).toBe(false);
  });

  it('rejects files outside their model folder', () => {
    const bad = manifest(1);
    bad.models['pose-320-coreml'].files[0].path = 'form/other.onnx';
    expect(isManifest(bad)).toBe(false);
  });
});

describe('modelsToUpdate', () => {
  const wanted = ['pose-320-coreml', 'pose-256-coreml'];

  it('downloads everything published on a fresh install', () => {
    expect(modelsToUpdate(manifest(1), null, wanted)).toEqual(['pose-320-coreml']);
  });

  it('does nothing when the Hub is not newer', () => {
    expect(modelsToUpdate(manifest(3), manifest(3), wanted)).toEqual([]);
    expect(modelsToUpdate(manifest(2), manifest(3, 'y'), wanted)).toEqual([]);
  });

  it('skips a model whose files did not change in a newer manifest', () => {
    expect(modelsToUpdate(manifest(4), manifest(3), wanted)).toEqual([]);
  });

  it('downloads a model whose files changed', () => {
    expect(modelsToUpdate(manifest(4, 'new'), manifest(3, 'old'), wanted)).toEqual(['pose-320-coreml']);
  });

  it('ignores models the phone does not use', () => {
    const remote = manifest(2);
    remote.models['form-quality-label-onnx'] = { format: 'onnx', path: 'form/a.onnx', files: [{ path: 'form/a.onnx', size: 1, md5: 'z' }] };
    expect(modelsToUpdate(remote, null, wanted)).toEqual(['pose-320-coreml']);
  });
});

describe('hubFileUrl', () => {
  it('builds a resolve URL and encodes each segment', () => {
    expect(hubFileUrl('bubblesmal/spotter-models', 'pose/a b.mlpackage/Manifest.json')).toBe(
      'https://huggingface.co/bubblesmal/spotter-models/resolve/main/pose/a%20b.mlpackage/Manifest.json',
    );
  });
});
