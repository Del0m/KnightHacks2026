// Checks the form rules against the human labels in an AI-09 export bundle (AI-10).
//   npx tsx scripts/check-rule-labels.ts <bundle.json> [report.md] [--ignore-label <label>]...
// Keep the bundle and the report out of the repo: they come from a consenting participant.

import fs from 'fs';

import { checkClip, readBundle, renderReport } from '../src/engine/__fixtures__/labelCheck';

const args = process.argv.slice(2);
const ignoreLabels: string[] = [];
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ignore-label') ignoreLabels.push(args[++i]);
  else paths.push(args[i]);
}
const [bundlePath, reportPath] = paths;
if (!bundlePath || ignoreLabels.some((l) => !l)) {
  console.error('usage: check-rule-labels.ts <bundle.json> [report.md] [--ignore-label <label>]...');
  process.exit(2);
}
const clips = readBundle(JSON.parse(fs.readFileSync(bundlePath, 'utf8')));
const labelled = clips.filter((c) => c.annotations.some((a) => a.state === 'accepted'));
const report = renderReport(labelled.map((c) => checkClip(c, { ignoreLabels })), { ignoreLabels });
if (reportPath) fs.writeFileSync(reportPath, report);
console.log(report);
