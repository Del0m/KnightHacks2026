// BE-13: progress and insights, BE-06: exercise library, BE-01: health.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { loadSpecs, readSpecs } from "../src/services/exerciseSpecs.js";
import { rep, setup, setRecord } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

describe("health", () => {
  it("reports liveness and readiness without a token", async () => {
    expect((await request(t.app).get("/health")).body.status).toBe("ok");
    expect((await request(t.app).get("/health/ready")).body).toEqual({ status: "ok", db: "ok" });
    // Unknown routes need a token too, so they reveal nothing to anonymous callers.
    expect((await request(t.app).get("/nope")).status).toBe(401);
    expect((await (await t.as("h-user")).get("/nope")).status).toBe(404);
  });
});

describe("progress", () => {
  it("returns daily volume, the form-score trend, medal counts and PRs", async () => {
    const api = await t.as("pr-user");
    const now = Date.now();
    for (const [daysAgo, weight, flags] of [
      [3, 50, 1],
      [1, 55, 0],
    ] as const) {
      const at = new Date(now - daysAgo * 86_400_000).toISOString();
      const { id } = (await api.post("/sessions", { inference_mode: "coreml", started_at: at })).body;
      await api.post(
        `/sessions/${id}/sets`,
        setRecord({
          exercise_id: "squat",
          weight_kg: weight,
          reps: [rep(), rep(), rep(), rep(flags ? ["depth"] : [])],
        }),
      );
      await api.post(`/sessions/${id}/finish`, { finished_at: at });
    }

    const res = await api.get("/me/progress?days=14");
    expect(res.status).toBe(200);
    expect(res.body.daily).toHaveLength(2);
    expect(res.body.daily[0]).toMatchObject({ sessions: 1, sets: 1, reps: 4, volume_kg: 200 });
    expect(res.body.form_trend.map((s: { medal: string }) => s.medal)).toEqual(["silver", "gold"]);
    expect(res.body.medals).toEqual({ bronze: 0, silver: 1, gold: 1 });
    expect(res.body.personal_records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exercise_id: "squat", metric: "max_weight_kg", value: 55 }),
      ]),
    );
    expect((await api.get("/me/progress?days=2000")).status).toBe(400);
  });

  it("returns the latest risk insight per body part with a disclaimer", async () => {
    const api = await t.as("risk-user");
    await api.get("/me/profile"); // first request creates the user
    await t.db.insert(schema.riskInsights).values([
      { userId: "risk-user", bodyPart: "knee", score: 0.2, asOf: "2026-10-01", explanation: "old" },
      {
        userId: "risk-user",
        bodyPart: "knee",
        score: 0.62,
        asOf: "2026-10-08",
        explanation: "Knee-tracking flags rising",
      },
      { userId: "risk-user", bodyPart: "shoulder", score: 0.1, asOf: "2026-10-08" },
    ]);
    const res = await api.get("/me/insights");
    expect(res.body.disclaimer).toContain("not a diagnosis");
    expect(res.body.insights).toEqual([
      expect.objectContaining({
        body_part: "knee",
        level: "high",
        explanation: "Knee-tracking flags rising",
      }),
      expect.objectContaining({ body_part: "shoulder", level: "low" }),
    ]);
    expect((await (await t.as("nobody")).get("/me/insights")).body.insights).toEqual([]);
  });
});

describe("exercise library", () => {
  it("loads specs from JSON files and serves them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specs-"));
    const squat = {
      id: "squat",
      primary_angle: { name: "knee", joints: ["hip", "knee", "ankle"], side: "both_avg" },
      phases: { top: 165, lowering_start: 160, depth_target: 95 },
      rules: [
        {
          id: "depth",
          phase: "bottom",
          check: "knee <= depth_target",
          rest_note: "Next set, try lowering further.",
        },
      ],
    };
    await writeFile(path.join(dir, "squat.json"), JSON.stringify(squat));
    await writeFile(
      path.join(dir, "push_up.json"),
      JSON.stringify({ id: "push_up", name: "Push-up", muscles: ["chest"] }),
    );

    expect(await loadSpecs(t.db, dir)).toEqual(["push_up", "squat"]);
    expect(await loadSpecs(t.db, dir)).toHaveLength(2); // re-runnable

    const list = await request(t.app).get("/exercises");
    expect(list.body).toEqual([
      { id: "push_up", name: "Push-up", muscles: ["chest"], level: "beginner", has_spec: true },
      { id: "squat", name: "Squat", muscles: [], level: "beginner", has_spec: true },
    ]);
    const spec = await request(t.app).get("/exercises/squat/spec");
    expect(spec.body).toEqual(squat); // unchanged, keys not converted
    expect((await request(t.app).get("/exercises/deadlift/spec")).status).toBe(404);
  });

  it("rejects a spec whose id doesn't match its file name and tolerates a missing folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "specs-"));
    await writeFile(path.join(dir, "lunge.json"), JSON.stringify({ id: "squat" }));
    await expect(readSpecs(dir)).rejects.toThrow(/must match/);
    expect(await readSpecs(path.join(dir, "missing"))).toEqual([]);
  });
});
