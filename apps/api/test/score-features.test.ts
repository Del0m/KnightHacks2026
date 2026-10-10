// CONN-05: the API computes the form model's frame-derived features the same way the pipeline
// does for training (databricks/pipelines/spotter_sessions/tests/test_feature_parity.py runs the
// same fixtures), and sends them to Model Serving.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_FEATURES, repFeatures, type RepFeatures } from "../src/integrations/databricks/features.js";
import { DatabricksScorer, type ScoreSetInput } from "../src/integrations/databricks/score.js";
import type { JointFrame } from "../src/integrations/databricks/upload.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../specs/set-record/fixtures/features",
);

interface Fixture {
  name: string;
  sets: {
    exercise_id: string;
    frames: JointFrame[];
    reps: {
      start_ms: number | null;
      end_ms: number | null;
      tempo_ms: number;
      range_deg: number;
      flags: { rule_id: string; severity: string }[];
      expected: RepFeatures;
    }[];
  }[];
}

const fixtures: Fixture[] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8")));

function expectFeatures(actual: RepFeatures, expected: RepFeatures, where: string) {
  for (const key of Object.keys(expected) as (keyof RepFeatures)[]) {
    if (expected[key] === null) expect(actual[key], `${where} ${key}`).toBeNull();
    else expect(actual[key], `${where} ${key}`).toBeCloseTo(expected[key], 6);
  }
}

describe("repFeatures matches silver_reps", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      fixture.sets.forEach((set, s) => {
        const features = repFeatures(set.exercise_id, set.reps, set.frames);
        set.reps.forEach((rep, r) => expectFeatures(features[r]!, rep.expected, `set ${s} rep ${r}`));
      });
    });
  }

  it("gives nulls without frames", () => {
    expect(repFeatures("squat", [{ start_ms: 0, end_ms: 1000 }], undefined)).toEqual([NO_FEATURES]);
  });
});

describe("DatabricksScorer sends the features", () => {
  it("puts each rep's features in its dataframe record", async () => {
    let sent: Record<string, unknown>[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oidc/v1/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      }
      sent = JSON.parse(init!.body as string).dataframe_records;
      return new Response(
        JSON.stringify({ predictions: sent.map(() => ({ quality: 0.8, label: "clean" })) }),
      );
    }) as unknown as typeof fetch;
    const scorer = new DatabricksScorer(
      {
        host: "https://dbc.test",
        clientId: "a",
        clientSecret: "b",
        scopes: "model-serving",
        endpoint: "form-quality",
        timeoutMs: 1200,
      },
      fakeFetch,
      { warn: () => {} },
    );

    const set = fixtures[0]!.sets[0]!;
    const input: ScoreSetInput = {
      exercise_id: set.exercise_id,
      weight_kg: 60,
      reps: set.reps,
      frames: set.frames,
    };
    const score = await scorer.scoreSet(input);

    expect(score.source).toBe("databricks");
    expect(sent).toHaveLength(set.reps.length);
    set.reps.forEach((rep, r) => {
      expect(sent[r]).toMatchObject({ exercise_id: "squat", weight_kg: 60, range_deg: rep.range_deg });
      expectFeatures(sent[r] as unknown as RepFeatures, rep.expected, `rep ${r}`);
    });
  });
});
