import type { DatasetClip, RepAnnotation } from './contract.ts';
import { assertClip } from './validate.ts';

/** Human review is authoritative; suggestions never participate in this update. */
export function saveAnnotation(clip: DatasetClip, annotation: RepAnnotation): DatasetClip {
  if (clip.status === 'recording' && annotation.state === 'accepted') throw new Error('Stop capture before accepting a rep');
  const previous = clip.annotations.find((a) => a.rep_id === annotation.rep_id);
  const saved: RepAnnotation = {
    ...annotation,
    human_labels: [...annotation.human_labels],
    revision: previous ? previous.revision + 1 : 1,
  };
  const annotations = previous
    ? clip.annotations.map((a) => a.rep_id === saved.rep_id ? saved : a)
    : [...clip.annotations, saved];
  annotations.sort((a, b) => a.start_frame - b.start_frame);
  const updated = { ...clip, annotations };
  assertClip(updated);
  return updated;
}

export function deleteAnnotation(clip: DatasetClip, repId: string): DatasetClip {
  const updated = { ...clip, annotations: clip.annotations.filter((a) => a.rep_id !== repId) };
  assertClip(updated);
  return updated;
}
