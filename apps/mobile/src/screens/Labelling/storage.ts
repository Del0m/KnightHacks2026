import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { ConsentRecord, DatasetClip } from '../../../../../ml/labelling/src/contract';
import { validateConsent } from '../../../../../ml/labelling/src/validate';
import { createDraftRepository } from '../../../../../ml/labelling/src/repository';
import { createBundle } from '../../../../../ml/labelling/src/export';

const directory = () => {
  const root = new Directory(Paths.document, 'ai09');
  root.create({ intermediates: true, idempotent: true });
  return root;
};
const localFile = (name: string) => {
  if (!/^[a-zA-Z0-9_.%-]+$/.test(name)) throw new Error('Unsafe local filename');
  return new File(directory(), name);
};
export const newId = (prefix: string) => `${prefix}_${Crypto.randomUUID()}`;
export const digest = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
export const fileStorage = {
  async read(name: string) { const file = localFile(name); return file.exists ? file.text() : null; },
  async write(name: string, text: string) { localFile(name).write(text); },
  async list() { return directory().list().filter(item => item instanceof File).map(item => item.name); },
  async remove(name: string) { const file = localFile(name); if (file.exists) file.delete(); },
};
export const drafts = createDraftRepository(fileStorage);

export async function readConsents(): Promise<ConsentRecord[]> {
  const records = new Map<string, ConsentRecord>();
  for (const name of (await fileStorage.list()).filter(name => name.startsWith('private-consent-')).sort()) {
    const value = JSON.parse((await fileStorage.read(name))!);
    const errors = validateConsent(value);
    if (errors.length) throw new Error(`Consent evidence could not be read: ${errors.join('; ')}`);
    const previous = records.get(value.reference);
    if (!previous || value.status === 'withdrawn') records.set(value.reference, value);
  }
  return [...records.values()];
}

export async function saveConsent(consent: ConsentRecord) {
  const errors = validateConsent(consent);
  if (errors.length) throw new Error(errors.join('; '));
  const existing = await readConsents();
  if (existing.some(c => c.reference === consent.reference && c.status === 'withdrawn' && consent.status === 'active')) {
    throw new Error('Withdrawn consent cannot be reactivated');
  }
  const text = JSON.stringify(consent);
  const name = `private-consent-${consent.reference}-${newId('revision')}.json`;
  await fileStorage.write(name, text);
  if (await fileStorage.read(name) !== text) throw new Error('Consent write verification failed');
}

export async function withdrawParticipant(participantId: string) {
  // Consent is revoked before cleanup; failed deletion cannot make a stale draft eligible again.
  for (const consent of await readConsents()) {
    if (consent.participant_id === participantId && consent.status === 'active') await saveConsent({ ...consent, status: 'withdrawn' });
  }
  await drafts.deleteParticipant(participantId);
  for (const name of await fileStorage.list()) if (name.startsWith('labelling-export-')) await fileStorage.remove(name);
}

export async function exportAndShare(clips: DatasetClip[], _consents: ConsentRecord[]) {
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device');
  const bundle = await createBundle(clips, await readConsents(), digest);
  const name = `labelling-export-all-${newId('bundle')}.json`;
  const text = JSON.stringify(bundle);
  await fileStorage.write(name, text);
  if (await fileStorage.read(name) !== text) throw new Error('Export write verification failed');
  const uri = localFile(name).uri;
  // Opening/dismissing the sheet is not proof of recipient-side transfer. Keep the local bundle.
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'AI-09 joint dataset' });
  return { uri, manifest: bundle.manifest };
}

/** Separate private evidence transfer; this file must never be published with the dataset. */
export async function shareConsentEvidence() {
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device');
  const records = await readConsents();
  const name = `labelling-export-all-private-consents-${newId('bundle')}.json`;
  const text = JSON.stringify(records);
  await fileStorage.write(name, text);
  if (await fileStorage.read(name) !== text) throw new Error('Evidence write verification failed');
  await Sharing.shareAsync(localFile(name).uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Private AI-09 consent evidence' });
}
