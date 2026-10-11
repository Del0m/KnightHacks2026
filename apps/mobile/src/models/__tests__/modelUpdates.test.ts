// In-memory stand-in for expo-file-system: files are path -> contents, folders a set of paths.
// The fake checksum only has to agree between the fake file system and the published manifest.
const mockMd5 = (s: string) => `md5:${s.length}:${s}`;
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();
const mockServer = new Map<string, string>(); // url -> body

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-file-system', () => {
  const join = (base: { uri: string } | string, parts: string[]) =>
    [typeof base === 'string' ? base : base.uri, ...parts].join('/'); // keeps file:/// intact
  const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));
  class Directory {
    uri: string;
    constructor(base: { uri: string } | string, ...parts: string[]) {
      this.uri = join(base, parts);
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    get parentDirectory() {
      return new Directory(parentOf(this.uri));
    }
    create(opts: { idempotent?: boolean } = {}) {
      if (mockDirs.has(this.uri) && !opts.idempotent) throw new Error(`exists: ${this.uri}`);
      let p = this.uri;
      while (p.includes('/')) {
        mockDirs.add(p);
        p = parentOf(p);
      }
    }
    delete() {
      for (const k of [...mockFiles.keys()]) if (k.startsWith(`${this.uri}/`)) mockFiles.delete(k);
      for (const d of [...mockDirs]) if (d === this.uri || d.startsWith(`${this.uri}/`)) mockDirs.delete(d);
    }
    move(into: Directory) {
      const name = this.uri.slice(this.uri.lastIndexOf('/') + 1);
      const to = `${into.uri}/${name}`;
      for (const [k, v] of [...mockFiles]) if (k.startsWith(`${this.uri}/`)) { mockFiles.delete(k); mockFiles.set(to + k.slice(this.uri.length), v); }
      for (const d of [...mockDirs]) if (d === this.uri || d.startsWith(`${this.uri}/`)) { mockDirs.delete(d); mockDirs.add(to + d.slice(this.uri.length)); }
      this.uri = to;
    }
  }
  class File {
    uri: string;
    constructor(base: { uri: string } | string, ...parts: string[]) {
      this.uri = join(base, parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get parentDirectory() {
      return new Directory(parentOf(this.uri));
    }
    async text() {
      return mockFiles.get(this.uri)!;
    }
    write(content: string) {
      mockFiles.set(this.uri, content);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    info() {
      return { exists: this.exists, md5: this.exists ? mockMd5(mockFiles.get(this.uri)!) : undefined };
    }
    move(into: Directory) {
      const to = `${into.uri}/${this.uri.slice(this.uri.lastIndexOf('/') + 1)}`;
      mockFiles.set(to, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = to;
    }
    static async downloadFileAsync(url: string, dest: File) {
      if (!mockServer.has(url)) throw new Error(`404 ${url}`);
      if (!mockDirs.has(parentOf(dest.uri))) throw new Error(`no folder for ${dest.uri}`);
      mockFiles.set(dest.uri, mockServer.get(url)!);
      return dest;
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///doc') } };
});

import { checkForModelUpdates, downloadedModelUri } from '../modelUpdates';

const REPO = 'bubblesmal/steadyforum-models';
const url = (path: string) => `https://huggingface.co/${REPO}/resolve/main/${path}`;

function publish(version: number, weights: string, corrupt = false) {
  const pkg = 'pose/yolov8n-pose-320.mlpackage';
  const content = { [`${pkg}/Manifest.json`]: '{"pkg":1}', [`${pkg}/Data/weights.bin`]: weights };
  for (const [path, body] of Object.entries(content)) mockServer.set(url(path), corrupt ? `${body}!` : body);
  const manifest = {
    schema: 1,
    version,
    published_at: '2026-10-10T00:00:00Z',
    models: {
      'pose-320-coreml': {
        format: 'coreml',
        path: pkg,
        files: Object.entries(content).map(([path, body]) => ({ path, size: body.length, md5: mockMd5(body) })),
      },
    },
  };
  mockServer.set(url('manifest.json'), JSON.stringify(manifest));
}

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  mockServer.clear();
  globalThis.fetch = jest.fn(async (u: string) => {
    const body = mockServer.get(u);
    return { ok: body !== undefined, status: body ? 200 : 404, json: async () => JSON.parse(body!) };
  }) as unknown as typeof fetch;
});

const weightsFile = 'file:///doc/models/current/pose/yolov8n-pose-320.mlpackage/Data/weights.bin';

it('installs published models on first launch', async () => {
  publish(1, 'weights-v1');
  const result = await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] });
  expect(result).toEqual({ status: 'updated', version: 1, models: ['pose-320-coreml'] });
  expect(mockFiles.get(weightsFile)).toBe('weights-v1');
  expect(await downloadedModelUri('pose-320-coreml')).toBe('file:///doc/models/current/pose/yolov8n-pose-320.mlpackage');
  expect([...mockDirs].some((d) => d.includes('staging'))).toBe(false);
});

it('does nothing on the next launch if the Hub has not changed', async () => {
  publish(1, 'weights-v1');
  await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] });
  (globalThis.fetch as jest.Mock).mockClear();
  expect(await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] })).toEqual({ status: 'up-to-date', version: 1 });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only the manifest
});

it('replaces a model when a newer version is published', async () => {
  publish(1, 'weights-v1');
  await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] });
  publish(2, 'weights-v2');
  expect((await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] })).status).toBe('updated');
  expect(mockFiles.get(weightsFile)).toBe('weights-v2');
});

it('keeps the installed model when a download is corrupt', async () => {
  publish(1, 'weights-v1');
  await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] });
  publish(2, 'weights-v2', true);
  const result = await checkForModelUpdates({ repo: REPO, models: ['pose-320-coreml'] });
  expect(result.status).toBe('failed');
  expect(result.error).toMatch(/checksum mismatch/);
  expect(mockFiles.get(weightsFile)).toBe('weights-v1');
  expect([...mockDirs].some((d) => d.includes('staging'))).toBe(false);
});

it('reports a failure instead of throwing when the Hub is unreachable', async () => {
  expect((await checkForModelUpdates({ repo: REPO })).status).toBe('failed');
  expect(await downloadedModelUri('pose-320-coreml')).toBeNull();
});
