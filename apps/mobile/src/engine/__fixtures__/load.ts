/// <reference types="node" />
// Reads the committed clips. Node only (Jest): it uses fs and path.

import fs from 'fs';
import path from 'path';

import type { Clip } from '../recording';

/** A committed clip, synthetic or recorded (design §6). */
export type Fixture = Clip;

export const FIXTURES_DIR = __dirname;

/** Every `*.json` clip in this folder, sorted by name. */
export function loadFixtures(): Clip[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as Clip)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
