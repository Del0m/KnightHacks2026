import type { ExerciseId } from '@/data/workout';

type Command = { type: 'steadyforum:select'; id: ExerciseId | null }
  | { type: 'steadyforum:pause'; playing: boolean }
  | { type: 'steadyforum:active'; active: boolean }
  | { type: 'steadyforum:motion'; reduced: boolean }
  | { type: 'steadyforum:rotate'; degrees: number }
  | { type: 'steadyforum:zoom'; factor: number };

export function modelCommand(command: Command): string {
  if (command.type === 'steadyforum:select' && ![null, 'curl', 'squat', 'press', 'push_up', 'lunge'].includes(command.id)) {
    throw new Error('Unknown model exercise');
  }
  if (command.type === 'steadyforum:rotate' && (!Number.isFinite(command.degrees) || Math.abs(command.degrees) > 180)) throw new Error('Invalid model rotation');
  if (command.type === 'steadyforum:zoom' && (!Number.isFinite(command.factor) || command.factor < .5 || command.factor > 2)) throw new Error('Invalid model zoom');
  return `window.steadyforumNativeReceive?.(${JSON.stringify(command)});true;`;
}

export function modelEvent(message: string): 'ready' | 'error' | null {
  try {
    const type = JSON.parse(message)?.type;
    return type === 'steadyforum:model-ready' ? 'ready' : type === 'steadyforum:model-error' ? 'error' : null;
  } catch { return null; }
}

export function modelNavigationAllowed(url: string): boolean {
  return url === 'about:blank';
}

export function modelScroll(message: string): number | null {
  try {
    const data = JSON.parse(message);
    return data?.type === 'steadyforum:model-scroll' && typeof data.delta === 'number' && Number.isFinite(data.delta) && Math.abs(data.delta) <= 160 ? data.delta : null;
  } catch { return null; }
}
