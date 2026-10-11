// Renders every clip to out/. Usage: npm run render [-- CompositionId ...]
// Set BROWSER_EXECUTABLE to use a local Chrome instead of Remotion's download.
import { spawnSync } from 'node:child_process';

const all = ['ArchitectureFlow', 'ProblemStats', 'SponsorCards', 'TitleCard', 'CloseCard', 'RoughCut'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
const browser = process.env.BROWSER_EXECUTABLE ? [`--browser-executable=${process.env.BROWSER_EXECUTABLE}`] : [];

for (const id of ids) {
  const args = ['remotion', 'render', 'src/index.ts', id, `out/${id}.mp4`, '--codec=h264', '--crf=20', ...browser];
  const result = spawnSync('npx', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
