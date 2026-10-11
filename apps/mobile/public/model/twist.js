// Signed angle between two-finger positions, wrapped across the ±π seam.
export function twistDelta(previous, current) {
  if (!previous || !current) return 0;
  const angle = pair => Math.atan2(pair[1].y - pair[0].y, pair[1].x - pair[0].x);
  if ([previous, current].some(pair => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y) < 12)) return 0;
  const delta = angle(current) - angle(previous);
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

export function gestureKind(start, current) {
  if (!start || !current) return null;
  const distance = pair => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
  const d = distance(start);
  if (d < 12 || distance(current) < 12) return null;
  const rotation = Math.abs(twistDelta(start, current));
  const pinch = Math.abs(Math.log(distance(current) / d));
  const pan = Math.hypot((current[0].x + current[1].x - start[0].x - start[1].x) / 2, (current[0].y + current[1].y - start[0].y - start[1].y) / 2) / d;
  const amount = Math.max(rotation, pinch, pan);
  if (amount < .08) return null;
  return amount === rotation ? 'rotate' : amount === pinch ? 'zoom' : 'pan';
}
