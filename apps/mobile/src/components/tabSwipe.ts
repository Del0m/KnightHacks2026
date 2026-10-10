export const mainTabPaths = ['/', '/plan', '/feed', '/buddies', '/me'] as const;
export function adjacentTab(path: string, dx: number, dy: number, touches: number) {
  const index = mainTabPaths.indexOf(path as typeof mainTabPaths[number]);
  if (index < 0 || touches !== 1 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2.5) return null;
  return mainTabPaths[index + (dx < 0 ? 1 : -1)] ?? null;
}

/** Resist movement beyond the end tabs while retaining a small elastic stretch. */
export function elasticTabPosition(position: number, last: number) {
  const clamped = Math.max(0, Math.min(last, position));
  return clamped + Math.max(-24, Math.min(24, (position - clamped) * .18));
}
export function tabAtPosition(position: number, slot: number, count: number) {
  return slot > 0 ? Math.max(0, Math.min(count - 1, Math.round(position / slot))) : 0;
}
