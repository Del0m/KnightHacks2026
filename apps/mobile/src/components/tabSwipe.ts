export const mainTabPaths = ['/', '/plan', '/feed', '/buddies', '/me'] as const;
export function adjacentTab(path: string, dx: number, dy: number, touches: number) {
  const index = mainTabPaths.indexOf(path as typeof mainTabPaths[number]);
  if (index < 0 || touches !== 1 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2.5) return null;
  return mainTabPaths[index + (dx < 0 ? 1 : -1)] ?? null;
}
