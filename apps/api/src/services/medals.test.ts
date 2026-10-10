// BE-05: medal tiers, the first-workout baseline and PR detection.
import { describe, expect, it } from "vitest";
import {
  BEGINNER_BASELINE,
  baselineShare,
  detectPrs,
  estimatedOneRepMax,
  formScore,
  pickWorkoutMedal,
  sessionBests,
} from "./medals.js";

describe("pickWorkoutMedal", () => {
  it("gives gold when every rep is clean", () => {
    expect(pickWorkoutMedal(24, 24, 0.95)).toBe("gold");
  });

  it("gives silver at or above the lifter's own average", () => {
    expect(pickWorkoutMedal(20, 24, 0.8)).toBe("silver"); // 0.833 >= 0.8
    expect(pickWorkoutMedal(3, 4, 0.75)).toBe("silver"); // exactly equal
  });

  it("gives bronze below the average", () => {
    expect(pickWorkoutMedal(15, 24, 0.8)).toBe("bronze");
  });

  it("compares a first workout with the 70% beginner baseline", () => {
    const baseline = baselineShare([]);
    expect(baseline).toBe(BEGINNER_BASELINE);
    expect(pickWorkoutMedal(7, 10, baseline)).toBe("silver");
    expect(pickWorkoutMedal(6, 10, baseline)).toBe("bronze");
    expect(pickWorkoutMedal(10, 10, baseline)).toBe("gold");
  });

  it("does not lose 'matched the average' to float error", () => {
    const baseline = baselineShare([0.7, 0.8, 0.9]); // 0.7999999999999999 in floats
    expect(pickWorkoutMedal(4, 5, baseline)).toBe("silver");
  });

  it("gives bronze for a finished workout with no reps (showing up counts)", () => {
    expect(formScore(0, 0)).toBe(0);
    expect(pickWorkoutMedal(0, 0, 0.7)).toBe("bronze");
  });
});

describe("personal records", () => {
  it("uses Epley for the estimated 1RM", () => {
    expect(estimatedOneRepMax(100, 5)).toBeCloseTo(116.667, 2);
  });

  it("keeps the best set per exercise and metric", () => {
    const bests = sessionBests([
      { exerciseId: "squat", reps: 8, weightKg: 60 },
      { exerciseId: "squat", reps: 5, weightKg: 70 },
      { exerciseId: "push_up", reps: 12, weightKg: null },
      { exerciseId: "push_up", reps: 15, weightKg: 0 },
    ]);
    expect(bests).toEqual(
      expect.arrayContaining([
        { exerciseId: "squat", metric: "max_weight_kg", value: 70 },
        { exerciseId: "squat", metric: "est_1rm_kg", value: 81.67 },
        { exerciseId: "push_up", metric: "max_reps", value: 15 },
      ]),
    );
    expect(bests).toHaveLength(3);
  });

  it("counts a first value as a PR and only beats strictly higher ones after that", () => {
    const candidates = sessionBests([{ exerciseId: "squat", reps: 5, weightKg: 70 }]);
    const first = detectPrs(candidates, () => null);
    expect(first.map((p) => p.metric).sort()).toEqual(["est_1rm_kg", "max_weight_kg"]);
    expect(first.every((p) => p.previousValue === null)).toBe(true);

    const prev: Record<string, number> = { max_weight_kg: 70, est_1rm_kg: 80 };
    const later = detectPrs(candidates, (_e, m) => prev[m] ?? null);
    expect(later).toEqual([{ exerciseId: "squat", metric: "est_1rm_kg", value: 81.67, previousValue: 80 }]);
  });
});
