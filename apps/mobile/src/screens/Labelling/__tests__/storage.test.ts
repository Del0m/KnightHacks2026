import { exportAndShare, saveConsent, readConsents, withdrawParticipant } from '../storage';

const mockFiles = new Map<string, string>();
const mockShare = jest.fn();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get exists() { return true; }
    create() {}
    list() { return [...mockFiles.keys()].filter(k => k.startsWith(this.uri + '/')).map(k => new File(k)); }
  }
  class File {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get name() { return this.uri.split('/').at(-1); }
    get exists() { return mockFiles.has(this.uri); }
    write(text: string) { mockFiles.set(this.uri, text); }
    async text() { return mockFiles.get(this.uri); }
    delete() { mockFiles.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: 'documents' } };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => 'random-id', CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_: string, value: string) => jest.requireActual('node:crypto').createHash('sha256').update(value).digest('hex') }), { virtual: true });
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (...args: unknown[]) => mockShare(...args) }), { virtual: true });

const consent = { reference: 'consent_a', participant_id: 'participant_a', version: 'joint-capture-v1', granted_at: '2026-10-10T19:00:00.000Z', purpose: 'private_model_development', status: 'active', publication_allowed: false } as const;

beforeEach(() => { mockFiles.clear(); mockShare.mockReset().mockResolvedValue(undefined); });

test('private consent survives reload and is not included as evidence in the shared bundle', async () => {
  await saveConsent(consent);
  expect(await readConsents()).toEqual([consent]);
  const result = await exportAndShare([], [consent]);
  expect(mockShare).toHaveBeenCalledWith(expect.stringContaining('export-'), expect.objectContaining({ mimeType: 'application/json' }));
  expect(mockFiles.get(result.uri)).not.toContain('granted_at');
});

test('a cancelled or failed share preserves the validated local export and consent', async () => {
  await saveConsent(consent);
  mockShare.mockRejectedValue(new Error('share cancelled'));
  await expect(exportAndShare([], [consent])).rejects.toThrow('share cancelled');
  expect([...mockFiles.keys()].some(k => k.includes('export-'))).toBe(true);
  expect(await readConsents()).toEqual([consent]);
});

test('withdrawal prevents private data and linked managed exports from being restored', async () => {
  await saveConsent(consent);
  await exportAndShare([], [consent]);
  await withdrawParticipant('participant_a');
  expect((await readConsents())[0].status).toBe('withdrawn');
  expect([...mockFiles.keys()].some(k => k.includes('export-'))).toBe(false);
});
