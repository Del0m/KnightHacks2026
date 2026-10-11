import { isPoseResult, type PoseResult } from '@/pose/types';
import { jointToView } from '@/pose/overlayGeometry';

export type Size = { width: number; height: number };
export type Framing = { kind: 'tracking' | 'distance' | 'closer' | 'center' | 'ready'; title: string; hint: string; visible: number };
export const FRAME_STALE_MS = 1000;
export const JOINT_CONFIDENCE = 0.35;
const margin = 0.08;
export function assessFraming(result: PoseResult | undefined, image: Size, view: Size, mirrored: boolean, now: number): Framing {
  const tracking: Framing = { kind: 'tracking', title: 'Looking for you', hint: 'Return to your exercise spot with your whole body visible.', visible: 0 };
  if (!isPoseResult(result) || now - result.timestamp_ms > FRAME_STALE_MS || result.timestamp_ms > now + 250 || result.score < 0.25 || image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) return tracking;
  const confident = result.joints.filter(j => j.c >= JOINT_CONFIDENCE && j.c <= 1 && j.x >= 0 && j.x <= 1 && j.y >= 0 && j.y <= 1);
  const points = confident.map(j => jointToView(j, image, view, mirrored, 'cover'));
  const visible = points.filter(p => p.x >= 0 && p.x <= view.width && p.y >= 0 && p.y <= view.height).length;
  if (points.some(p => p.x < margin * view.width || p.x > (1 - margin) * view.width || p.y < margin * view.height || p.y > (1 - margin) * view.height)) return { kind: 'distance', title: 'Give yourself more room', hint: 'Move the phone farther from your exercise spot. Keep room above your head and below your feet.', visible };
  if (confident.length < 17) return { ...tracking, title: 'Bring your whole body into view', hint: 'Adjust the phone angle so it can see your face, hands and feet. Make sure the light is in front of you.', visible };
  const height = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  if (height < view.height * 0.45) return { kind: 'closer', title: 'Bring the camera closer', hint: 'Move the phone a little closer to your exercise spot, keeping your head and feet in view.', visible };
  const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  if (centerX < view.width * 0.3 || centerX > view.width * 0.7) return { kind: 'center', title: 'Center your exercise spot', hint: 'Turn the phone slightly toward your spot so you’re in the middle of the preview.', visible };
  return { kind: 'ready', title: 'You’re in frame', hint: 'Check that your full movement stays inside the outline.', visible };
}
export function updateStability(since: number | null, inFrame: boolean, now: number) {
  if (!inFrame) return { since: null, ready: false };
  const start = since ?? now;
  return { since: start, ready: now - start >= 1000 };
}
