// BE-03: profile and injuries.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

describe("profile", () => {
  it("returns a default profile for a new user and updates it", async () => {
    const api = await t.as("p-user-1");
    const first = await api.get("/me/profile");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      id: "p-user-1",
      experience_level: "beginner",
      schedule: [],
      goals: [],
    });
    expect(first.body).not.toHaveProperty("embedding");

    const res = await api.put("/me/profile", {
      handle: "squat_sam",
      display_name: "Sam",
      gym_place_id: "gym-ucf",
      gym_name: "UCF RWC",
      schedule: ["mon_am", "wed_am"],
      goals: ["strength"],
      auto_post_medals: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      handle: "squat_sam",
      display_name: "Sam",
      gym_name: "UCF RWC",
      schedule: ["mon_am", "wed_am"],
      auto_post_medals: true,
      auto_post_prs: false,
    });

    // Partial update leaves other fields alone.
    const partial = await api.put("/me/profile", { experience_level: "intermediate" });
    expect(partial.body).toMatchObject({
      handle: "squat_sam",
      experience_level: "intermediate",
      gym_name: "UCF RWC",
    });
  });

  it("validates with Zod and rejects unknown fields", async () => {
    const api = await t.as("p-user-2");
    const bad = await api.put("/me/profile", { handle: "No Spaces!", schedule: ["monday"], is_admin: true });
    expect(bad.status).toBe(400);
    const paths = bad.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["handle", "schedule.0"]));
  });

  it("returns 409 for a taken handle", async () => {
    const a = await t.as("p-user-3");
    const b = await t.as("p-user-4");
    expect((await a.put("/me/profile", { handle: "taken_name" })).status).toBe(200);
    const res = await b.put("/me/profile", { handle: "taken_name" });
    expect(res.status).toBe(409);
  });

  it("requires a token", async () => {
    expect((await request(t.app).get("/me/profile")).status).toBe(401);
  });
});

describe("injuries", () => {
  it("adds, lists and deletes injuries, private by default", async () => {
    const api = await t.as("i-user-1");
    const created = await api.post("/me/injuries", {
      body_part: "knee",
      severity: "moderate",
      since: "2026-08-01",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ body_part: "knee", severity: "moderate", is_private: true });

    const list = await api.get("/me/injuries");
    expect(list.body).toHaveLength(1);

    expect((await api.delete(`/me/injuries/${created.body.id}`)).status).toBe(204);
    expect((await api.get("/me/injuries")).body).toHaveLength(0);
  });

  it("can't delete someone else's injury, and validates input", async () => {
    const owner = await t.as("i-user-2");
    const other = await t.as("i-user-3");
    const { body } = await owner.post("/me/injuries", { body_part: "shoulder" });
    expect((await other.delete(`/me/injuries/${body.id}`)).status).toBe(404);
    expect((await owner.get("/me/injuries")).body).toHaveLength(1);

    expect((await owner.post("/me/injuries", { body_part: "spleen" })).status).toBe(400);
    expect((await owner.post("/me/injuries", { body_part: "knee", since: "last week" })).status).toBe(400);
    expect((await owner.delete("/me/injuries/not-a-uuid")).status).toBe(400);
  });
});
