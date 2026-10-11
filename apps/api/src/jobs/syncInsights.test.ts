// AI-14 / CONN-06: the risk sync reads the model's scores first and falls back to the heuristic.
//
// Expected seam in syncInsights.ts (readGold passes its Databricks `run` as `query`):
//
//   export type RiskSource = "model" | "heuristic";
//   export async function readRiskRows(
//     query: (sql: string) => Promise<RiskRow[]>,
//     log: LogLike = console,
//     days?: number, // lookback window for the WHERE clause; defaults to the config's
//   ): Promise<{ rows: RiskRow[]; source: RiskSource }>;
//
// 1. Query spotter.gold.gold_injury_risk_model_scores (same columns as the heuristic table:
//    user_id, body_part, date, score, top_features).
// 2. If that throws or returns no rows, query spotter.gold.gold_injury_risk_scores as today.
//    If the heuristic read throws too, the error propagates (readGold records it as failed).
// 3. Log which source was used, naming the table.
//
// The rows go through upsertRisk unchanged, and explainRisk() works on the model's
// top_features because they use the same family names.

import { describe, expect, it, vi } from "vitest";
import { readRiskRows, upsertRisk, type Db, type RiskRow } from "./syncInsights";

const MODEL_TABLE = "spotter.gold.gold_injury_risk_model_scores";
const HEURISTIC_TABLE = "spotter.gold.gold_injury_risk_scores";

const modelRow: RiskRow = {
  user_id: "pseudo-1",
  body_part: "knee",
  date: "2026-10-09",
  score: 0.71,
  top_features: ["acute_chronic_load", "range_shrinking"],
};
const heuristicRow: RiskRow = {
  user_id: "pseudo-1",
  body_part: "knee",
  date: "2026-10-09",
  score: 0.4,
  top_features: ["flag_rate_rising"],
};

// A fake Databricks reader: answers per table, and records which statements it was given.
function fakeQuery(tables: { model: RiskRow[] | Error; heuristic: RiskRow[] | Error }) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string): Promise<RiskRow[]> => {
    statements.push(sql);
    const answer = sql.includes(MODEL_TABLE)
      ? tables.model
      : sql.includes(HEURISTIC_TABLE)
        ? tables.heuristic
        : new Error(`unexpected statement: ${sql}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { query, statements };
}

function fakeLog() {
  const info = vi.fn<(msg: string) => void>();
  const error = vi.fn<(msg: string) => void>();
  const messages = () => [...info.mock.calls, ...error.mock.calls].map(([m]) => m).join("\n");
  return { log: { info, error }, messages };
}

describe("AI-14 risk source: model first, heuristic fallback", () => {
  it("uses the model's rows when the model table has them, and doesn't read the heuristic", async () => {
    const { query, statements } = fakeQuery({ model: [modelRow], heuristic: [heuristicRow] });
    const { log, messages } = fakeLog();

    const result = await readRiskRows(query, log);

    expect(result).toEqual({ rows: [modelRow], source: "model" });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(MODEL_TABLE);
    // Same columns as the heuristic table.
    for (const col of ["user_id", "body_part", "date", "score", "top_features"]) {
      expect(statements[0]).toContain(col);
    }
    expect(messages()).toContain("gold_injury_risk_model_scores");
  });

  it("falls back to the heuristic when the model table is missing", async () => {
    const { query, statements } = fakeQuery({
      model: new Error("[TABLE_OR_VIEW_NOT_FOUND] gold_injury_risk_model_scores cannot be found"),
      heuristic: [heuristicRow],
    });
    const { log, messages } = fakeLog();

    const result = await readRiskRows(query, log);

    expect(result).toEqual({ rows: [heuristicRow], source: "heuristic" });
    expect(statements.map((s) => s.includes(MODEL_TABLE))).toEqual([true, false]);
    expect(statements[1]).toContain(HEURISTIC_TABLE);
    expect(messages()).toContain("gold_injury_risk_scores");
  });

  it("falls back to the heuristic when the model table is empty", async () => {
    const { query, statements } = fakeQuery({ model: [], heuristic: [heuristicRow] });
    const { log, messages } = fakeLog();

    const result = await readRiskRows(query, log);

    expect(result).toEqual({ rows: [heuristicRow], source: "heuristic" });
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain(HEURISTIC_TABLE);
    expect(messages()).toContain("gold_injury_risk_scores");
  });

  it("lets the heuristic's error through when both reads fail, so the table is left as it was", async () => {
    const { query } = fakeQuery({
      model: new Error("model table missing"),
      heuristic: new Error("warehouse unavailable"),
    });
    const { log } = fakeLog();

    await expect(readRiskRows(query, log)).rejects.toThrow("warehouse unavailable");
  });

  it("explains model rows from the family names, through the same upsert", async () => {
    const { query } = fakeQuery({ model: [modelRow], heuristic: [heuristicRow] });
    const { rows } = await readRiskRows(query, fakeLog().log);

    const calls: unknown[][] = [];
    const db: Db = {
      query: async (_text, params) => {
        calls.push(params ?? []);
        return [];
      },
    };
    await upsertRisk(
      db,
      rows.map((r) => ({ ...r, neon_user_id: "user-1" })),
    );

    expect(calls).toHaveLength(1);
    const [userIds, bodyParts, dates, scores, explanations, features] = calls[0]!;
    expect(userIds).toEqual(["user-1"]);
    expect(bodyParts).toEqual(["knee"]);
    expect(dates).toEqual(["2026-10-09"]);
    expect(scores).toEqual([0.71]);
    expect(features).toEqual([JSON.stringify(["acute_chronic_load", "range_shrinking"])]);
    expect(explanations).toEqual([
      "Worth keeping an eye on your knee: this week's training load jumped compared with your recent weeks" +
        " and your range of motion has been getting smaller. This is a training trend, not a diagnosis.",
    ]);
  });
});

// The model read also returns how long ago the latest scoring run was (minutes, from Databricks'
// own clock); a run older than 36 hours means the scoring job has stopped, so the heuristic wins.
describe("AI-14 risk source: stale model scores fall back to the heuristic", () => {
  const scoredAgo = (minutes: number | null) =>
    ({ ...modelRow, scored_minutes_ago: minutes }) as unknown as RiskRow;

  it("asks Databricks for the latest scored_at alongside the model rows", async () => {
    const { query, statements } = fakeQuery({ model: [scoredAgo(60)], heuristic: [heuristicRow] });

    await readRiskRows(query, fakeLog().log);

    expect(statements[0]).toContain(MODEL_TABLE);
    expect(statements[0]).toContain("max(scored_at)");
    expect(statements[0]).toContain("scored_minutes_ago");
    // The heuristic table has no scored_at.
    expect(statements.slice(1).join("\n")).not.toContain("scored_at");
  });

  it("uses fresh model rows, returned in the plain RiskRow shape for the upsert", async () => {
    const { query, statements } = fakeQuery({ model: [scoredAgo(2 * 60)], heuristic: [heuristicRow] });

    const result = await readRiskRows(query, fakeLog().log);

    expect(result).toEqual({ rows: [modelRow], source: "model" });
    expect(Object.keys(result.rows[0]!).sort()).toEqual(Object.keys(modelRow).sort());
    expect(statements).toHaveLength(1);
  });

  it("still counts rows scored exactly 36 hours ago as fresh", async () => {
    const { query } = fakeQuery({ model: [scoredAgo(36 * 60)], heuristic: [heuristicRow] });

    const result = await readRiskRows(query, fakeLog().log);

    expect(result.source).toBe("model");
  });

  it("falls back to the heuristic when the model's latest scores are more than 36 hours old", async () => {
    const { query, statements } = fakeQuery({
      model: [scoredAgo(37 * 60), scoredAgo(37 * 60)],
      heuristic: [heuristicRow],
    });
    const { log, messages } = fakeLog();

    const result = await readRiskRows(query, log);

    expect(result).toEqual({ rows: [heuristicRow], source: "heuristic" });
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain(HEURISTIC_TABLE);
    expect(messages()).toContain("gold_injury_risk_scores");
    expect(messages()).toMatch(/stale/);
    expect(messages()).toContain("37 h");
  });

  it("treats model rows without a scored_at as stale", async () => {
    const { query } = fakeQuery({ model: [scoredAgo(null)], heuristic: [heuristicRow] });
    const { log, messages } = fakeLog();

    const result = await readRiskRows(query, log);

    expect(result).toEqual({ rows: [heuristicRow], source: "heuristic" });
    expect(messages()).toMatch(/stale/);
  });
});
