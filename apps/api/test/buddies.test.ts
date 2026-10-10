// BE-12: buddy suggestions, scoring and requests.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import {
  describeSlot,
  jaccard,
  scorePair,
  type MatchCandidate,
  type MatchProfile,
} from "../src/services/matching.js";
import { setup } from "./helpers.js";

describe("scorePair", () => {
  const me: MatchProfile = {
    userId: "a",
    handle: "a",
    displayName: null,
    experienceLevel: "beginner",
    gymPlaceId: "gym-1",
    gymName: "RWC",
    schedule: ["mon_am", "wed_am", "fri_pm"],
    goals: ["strength", "consistency"],
    weeklySessions: 3,
  };

  it("weights goals 40%, schedule 30%, level 20%, streak 10%", () => {
    const twin: MatchCandidate = { ...me, userId: "b", handle: "b", distanceKm: 0, goalSimilarity: null };
    expect(scorePair(me, twin).score).toBe(1);

    const other: MatchCandidate = {
      ...twin,
      experienceLevel: "advanced", // level gap 2 -> 0
      schedule: ["sun_eve"], // no overlap -> 0
      goals: ["strength"], // jaccard 1/2
      weeklySessions: 1.5, // 1 - 1.5/3 = 0.5
    };
    const scored = scorePair(me, other);
    expect(scored.parts).toEqual({ goals: 0.5, schedule: 0, level: 0, streak: 0.5 });
    expect(scored.score).toBeCloseTo(0.4 * 0.5 + 0.1 * 0.5);
  });

  it("prefers embedding similarity over goal tags when both have embeddings", () => {
    const them: MatchCandidate = {
      ...me,
      userId: "c",
      handle: "c",
      goals: [],
      distanceKm: null,
      goalSimilarity: 0.9,
    };
    expect(scorePair(me, them).parts.goals).toBe(0.9);
  });

  it("explains the match in plain words", () => {
    const them: MatchCandidate = { ...me, userId: "d", handle: "d", distanceKm: 0, goalSimilarity: null };
    expect(scorePair(me, them).reasons).toEqual([
      "Same gym: RWC",
      "Both beginners",
      "Both train Monday mornings and Wednesday mornings",
      "Shared goals: strength, consistency",
      "Similar training rhythm",
    ]);
    expect(describeSlot("fri_eve")).toBe("Friday evenings");
    expect(jaccard([], [])).toBe(0);
  });
});

describe("buddy endpoints", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup();
  });
  afterAll(() => t.close());

  it("suggests nearby lifters at a similar level and handles request, accept and decline", async () => {
    const me = await t.as("b-me");
    const profiles: [string, object][] = [
      [
        "b-me",
        { gym_place_id: "gym-1", gym_lat: 28.6, gym_lng: -81.2, schedule: ["mon_am"], goals: ["strength"] },
      ],
      ["b-twin", { gym_place_id: "gym-1", schedule: ["mon_am"], goals: ["strength"] }],
      ["b-near", { gym_place_id: "gym-9", gym_lat: 28.61, gym_lng: -81.2, schedule: ["tue_pm"] }], // ~1.1 km
      ["b-far", { gym_place_id: "gym-8", gym_lat: 28.9, gym_lng: -81.2 }], // ~33 km
      ["b-pro", { gym_place_id: "gym-1", experience_level: "advanced" }], // two levels apart
      ["b-blocked", { gym_place_id: "gym-1" }],
    ];
    for (const [id, body] of profiles)
      expect((await (await t.as(id)).put("/me/profile", body)).status).toBe(200);
    await t.db.insert(schema.blocks).values({ blockerId: "b-blocked", blockedId: "b-me" });

    const res = await me.get("/buddies/suggestions");
    expect(res.status).toBe(200);
    const ids = res.body.suggestions.map((s: { user: { id: string } }) => s.user.id);
    expect(ids).toEqual(["b-twin", "b-near"]);
    expect(res.body.suggestions[0].reasons).toContain("Same gym");
    expect(res.body.suggestions[1].reasons[0]).toMatch(/^Gyms 1\.\d km apart$/);

    // Request -> no longer suggested; recipient accepts.
    const reqRes = await me.post("/buddies/b-twin/request");
    expect(reqRes.status).toBe(201);
    expect(reqRes.body).toMatchObject({ a_id: "b-me", b_id: "b-twin", status: "requested" });
    expect((await me.post("/buddies/b-twin/request")).status).toBe(409);
    const twin = await t.as("b-twin");
    expect((await twin.post("/buddies/b-me/request")).status).toBe(409); // pair already exists
    expect((await me.post("/buddies/b-twin/accept")).status).toBe(404); // only the recipient can accept
    expect((await twin.post("/buddies/b-me/accept")).body.status).toBe("accepted");

    const mine = await me.get("/buddies");
    expect(mine.body).toEqual([
      expect.objectContaining({ user_id: "b-twin", status: "accepted", direction: "outgoing" }),
    ]);

    const after = await me.get("/buddies/suggestions");
    expect(after.body.suggestions.map((s: { user: { id: string } }) => s.user.id)).toEqual(["b-near"]);

    // Decline
    await me.post("/buddies/b-near/request");
    const near = await t.as("b-near");
    expect((await near.post("/buddies/b-me/decline")).body.status).toBe("declined");
    const [row] = await t.db.select().from(schema.buddyMatches).where(eq(schema.buddyMatches.bId, "b-near"));
    expect(row?.status).toBe("declined");

    expect((await me.post("/buddies/b-blocked/request")).status).toBe(404);
    expect((await me.post("/buddies/b-me/request")).status).toBe(400);
  });

  it("asks for a gym before suggesting anyone", async () => {
    const res = await (await t.as("b-nogym")).get("/buddies/suggestions");
    expect(res.body).toEqual({ suggestions: [], hint: expect.stringContaining("gym") });
  });

  it("ranks by profile embeddings when they exist", async () => {
    const unit = (i: number) => Array.from({ length: 384 }, (_, j) => (j === i ? 1 : 0));
    for (const id of ["e-me", "e-close", "e-far"])
      await (await t.as(id)).put("/me/profile", { gym_place_id: "gym-e" });
    await t.db
      .update(schema.profiles)
      .set({ embedding: unit(0) })
      .where(eq(schema.profiles.userId, "e-me"));
    await t.db
      .update(schema.profiles)
      .set({ embedding: unit(0) })
      .where(eq(schema.profiles.userId, "e-close"));
    await t.db
      .update(schema.profiles)
      .set({ embedding: unit(5) })
      .where(eq(schema.profiles.userId, "e-far"));
    const res = await (await t.as("e-me")).get("/buddies/suggestions");
    expect(res.body.suggestions[0].user.id).toBe("e-close");
    expect(res.body.suggestions[0].parts.goals).toBeCloseTo(1);
    expect(res.body.suggestions[0].reasons).toContain("Similar goals");
  });
});
