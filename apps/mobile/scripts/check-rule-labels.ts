// Checks the form rules against the human labels in an AI-09 export bundle (AI-10).
//   npx tsx scripts/check-rule-labels.ts <bundle.json> [report.md]
// Keep the bundle and the report out of the repo: they come from a consenting participant.

import fs from 'fs';

import { checkClip, readBundle, renderReport } from '../src/engine/__fixtures__/labelCheck';

const [bundlePath, reportPath] = process.argv.slice(2);
if (!bundlePath) {
  console.error('usage: check-rule-labels.ts <bundle.json> [report.md]');
  process.exit(2);
}
const clips = readBundle(JSON.parse(fs.readFileSync(bundlePath, 'utf8')));
const labelled = clips.filter((c) => c.annotations.some((a) => a.state === 'accepted'));
const report = renderReport(labelled.map(checkClip));
if (reportPath) fs.writeFileSync(reportPath, report);
console.log(report);
