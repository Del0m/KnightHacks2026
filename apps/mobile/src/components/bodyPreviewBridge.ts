import type { ExerciseId } from '@/data/workout';

type Command = { type: 'spotter:select'; id: ExerciseId | null }
  | { type: 'spotter:pause'; playing: boolean }
  | { type: 'spotter:active'; active: boolean }
  | { type: 'spotter:motion'; reduced: boolean };

export function modelCommand(command: Command): string {
  if (command.type === 'spotter:select' && ![null, 'curl', 'squat', 'press'].includes(command.id)) {
    throw new Error('Unknown model exercise');
  }
  return `window.spotterNativeReceive?.(${JSON.stringify(command)});true;`;
}

export function modelEvent(message: string): 'ready' | 'error' | null {
  try {
    const type = JSON.parse(message)?.type;
    return type === 'spotter:model-ready' ? 'ready' : type === 'spotter:model-error' ? 'error' : null;
  } catch { return null; }
}

export function modelNavigationAllowed(url: string): boolean {
  return url === 'about:blank';
}

export function modelScroll(message: string): number | null {
  try {
    const data = JSON.parse(message);
    return data?.type === 'spotter:model-scroll' && typeof data.delta === 'number' && Number.isFinite(data.delta) && Math.abs(data.delta) <= 160 ? data.delta : null;
  } catch { return null; }
}
