import type { DatasetClip } from './contract.ts';
import { assertClip } from './validate.ts';

export interface DraftStorage {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}
const encode = (id: string) => encodeURIComponent(id).replace(/-/g, '%2D');
const hash = (text: string) => {
  // Integrity checksum for accidental truncation/corruption, not an authenticity claim.
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0');
};
const tombstone = (id: string) => `labelling-deleted-${encode(id)}.json`;
function decode(text: string | null): { revision: number; clip: DatasetClip } | null {
  try {
    const value = JSON.parse(text ?? 'null');
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.payload !== 'string' || hash(value.payload) !== value.checksum) return null;
    const clip = JSON.parse(value.payload);
    assertClip(clip);
    return { revision: value.revision, clip };
  } catch { return null; }
}

/** One repository per storage adapter serializes mutations. Files are immutable generations. */
export function createDraftRepository(storage: DraftStorage) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  }
  async function deleted(id: string) { return await storage.read(tombstone(id)) !== null; }
  async function records() {
    const records: { name: string; revision: number; clip: DatasetClip }[] = [];
    for (const name of await storage.list()) {
      if (!name.startsWith('labelling-draft-') || !name.endsWith('.json')) continue;
      const record = decode(await storage.read(name));
      if (record) records.push({ name, ...record });
    }
    return records;
  }
  return {
    save(clip: DatasetClip): Promise<void> {
      // Snapshot at invocation, before waiting for earlier writes.
      const payload = JSON.stringify(clip);
      const participant = clip.participant_id, clipId = clip.clip_id;
      return serial(async () => {
        assertClip(JSON.parse(payload));
        if (await deleted(participant)) throw Error('Participant was deleted');
        const prefix = `labelling-draft-${encode(participant)}-${encode(clipId)}-`;
        // Include corrupted generations in allocation: never overwrite an immutable name.
        const revisions = (await storage.list()).filter(n => n.startsWith(prefix)).map(n => Number(n.slice(prefix.length, -5))).filter(Number.isSafeInteger);
        const revision = Math.max(0, ...revisions) + 1;
        const name = `${prefix}${String(revision).padStart(12, '0')}.json`;
        const text = JSON.stringify({ version: 1, revision, checksum: hash(payload), payload });
        await storage.write(name, text);
        if (await storage.read(name) !== text || !decode(text)) throw Error('Draft write verification failed');
        // Pruning is housekeeping after the durable commit. An interruption must neither
        // invalidate the new save nor remove either of the two newest valid generations.
        try {
          const valid = (await records()).filter(r => r.name.startsWith(prefix)).sort((a, b) => b.revision - a.revision);
          for (const old of valid.slice(2)) await storage.remove(old.name);
        } catch { /* Next successful checkpoint retries pruning. */ }
      });
    },
    list(): Promise<DatasetClip[]> {
      return serial(async () => {
        const latest = new Map<string, { revision: number; clip: DatasetClip }>();
        for (const record of await records()) {
          if (await deleted(record.clip.participant_id)) continue;
          const key = `${record.clip.participant_id}\0${record.clip.clip_id}`;
          if (!latest.has(key) || latest.get(key)!.revision < record.revision) latest.set(key, record);
        }
        return [...latest.values()].map(({ clip }) => clip.status === 'recording' ? { ...clip, status: 'incomplete', stop_reason: 'recovered' } : clip);
      });
    },
    deleteParticipant(id: string): Promise<void> {
      return serial(async () => {
        const name = tombstone(id), text = JSON.stringify({ participant_id: id, deleted: true });
        await storage.write(name, text);
        if (await storage.read(name) !== text) throw Error('Deletion tombstone verification failed');
        // Never remove the tombstone: old generations must stay withdrawn after recovery.
        const draftPrefix = `labelling-draft-${encode(id)}-`;
        const exportPrefix = `labelling-export-${encode(id)}-`;
        for (const file of await storage.list()) {
          if (file.startsWith(draftPrefix) || file.startsWith(exportPrefix) || file.startsWith('labelling-export-all-')) await storage.remove(file);
        }
      });
    },
  };
}
