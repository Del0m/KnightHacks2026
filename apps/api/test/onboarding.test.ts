// Real frontend adapter -> authenticated Express -> migrated Postgres -> reload.
import { afterAll, beforeAll, expect, it } from "vitest";
import { setup } from "./helpers.js";
import { loadProfile, saveOnboarding } from "../../mobile/src/screens/Onboarding/api.js";
import { createDraft, draftFromProfile } from "../../mobile/src/screens/Onboarding/model.js";
let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());
it("round-trips onboarding and edits without deleting other injuries", async () => {
  const api = await t.as("onboarding-user");
  const request = async (path: string, init?: RequestInit) => {
    const result =
      init?.method === "PUT" ? await api.put(path, JSON.parse(String(init.body))) : await api.get(path);
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
  expect((await loadProfile(request))?.onboarding_completed).toBe(false);
  await api.post("/me/injuries", { body_part: "shoulder", notes: "Existing clinician note" });
  await api.put("/me/profile", { schedule: ["mon_am", "wed_pm"] });
  const draft = {
    ...createDraft(),
    goals: ["muscle", "strength", "core"],
    experience: "experienced" as const,
    scheduleMode: "interval" as const,
    startDate: "2026-10-10",
    injury: "Left knee feels stiff.",
  };
  draft.bests[0] = { exercise: "squat", weight: "100", reps: "5" };
  await saveOnboarding(request, draft);
  expect((await api.get("/me/profile")).body.schedule).toEqual(["mon_am", "wed_pm"]);
  const loaded = (await loadProfile(request))!;
  expect(draftFromProfile(loaded)).toMatchObject({
    experience: "experienced",
    scheduleMode: "interval",
    interval: "3",
    injury: draft.injury,
  });
  expect(loaded.personal_bests).toEqual([{ exercise: "squat", weight: 100, unit: "lb", reps: 5 }]);
  await saveOnboarding(request, draft);
  expect((await api.get("/me/injuries")).body).toHaveLength(2);
  await saveOnboarding(request, { ...draft, injury: "Updated note", scheduleMode: "weekly", days: [2, 4] });
  expect((await loadProfile(request))?.schedule).toEqual({ kind: "weekly", days: [2, 4] });
  await saveOnboarding(request, { ...draft, injury: "" });
  expect((await loadProfile(request))?.injury_note).toBe("");
  expect((await api.get("/me/injuries")).body).toMatchObject([
    { body_part: "shoulder", notes: "Existing clinician note" },
  ]);
  const other = await t.as("other-user");
  expect((await other.get("/me/profile")).body.onboarding_completed).toBe(false);
});
it("rejects malformed cadence, bests and notes without changing profile", async () => {
  const api = await t.as("invalid-onboarding");
  for (const body of [
    { training_schedule: { kind: "interval", every_days: 3, start_date: "2026-02-30" } },
    { personal_bests: [{ exercise: "squat", weight: -1, unit: "lb", reps: 5 }] },
    { injury_note: "x".repeat(501) },
    { onboarding_completed: true },
  ]) {
    expect((await api.put("/me/profile", body)).status).toBe(400);
  }
  expect((await api.get("/me/profile")).body.onboarding_completed).toBe(false);
});
