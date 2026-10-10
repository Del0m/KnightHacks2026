// INT-09: every committed clip, replayed engine -> set record -> API -> Databricks upload, against
// a golden file per clip. After an intended behaviour change, regenerate them with
// `npm run test:replay -- -u` and review the diff.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReplayApi, loadClips, replayClip, type ReplayApi } from "./pipeline.js";

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__golden__");
const clips = loadClips();

let api: ReplayApi;
beforeAll(async () => {
  api = await createReplayApi();
});
afterAll(() => api.close());

describe("clip replay", () => {
  it("has clips to replay", () => {
    expect(clips.length).toBeGreaterThan(0);
  });

  for (const clip of clips) {
    it(clip.name, async () => {
      const result = await replayClip(api, clip);

      // The hand-checked expectations travel with the clip; the golden file pins everything else.
      if (clip.expected) {
        expect(result.engine).toMatchObject({
          reps: clip.expected.reps,
          partials: clip.expected.partials,
          set_end: clip.expected.set_end,
        });
      }
      expect(result.api).toMatchObject({ rows: { reps: expect.any(Array) } });
      expect((result.api as { rows: { reps: unknown[] } }).rows.reps).toHaveLength(result.engine.reps);
      expect(result.upload.export_status).toBe("exported");

      await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot(
        path.join(GOLDEN_DIR, `${clip.name}.json`),
      );
    });
  }
});
