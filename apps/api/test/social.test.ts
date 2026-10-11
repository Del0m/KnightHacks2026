// BE-09 feed and BE-10 social writes.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import type { Moderator } from "../src/services/moderation.js";
import { setup } from "./helpers.js";

const moderator: Moderator = {
  async check(text) {
    if (text === "moderation unavailable") return { allowed: true, checked: false };
    if (/hopeless/i.test(text))
      return { allowed: false, message: "Call or text 988.", support: true, categories: ["S11"] };
    if (/forbidden/i.test(text))
      return { allowed: false, message: "Please keep it kind.", categories: ["S15"] };
    return { allowed: true };
  },
};

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup({ moderator });
});
afterAll(() => t.close());

describe("posts, comments, kudos, follows", () => {
  it("saves a post that passes moderation and blocks one that doesn't", async () => {
    const api = await t.as("s-author");
    const ok = await api.post("/posts", { kind: "goal", body: "3 gold workouts this month" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: "goal", author_id: "s-author" });

    const blocked = await api.post("/posts", { kind: "goal", body: "something forbidden" });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ error: "moderation_blocked", message: "Please keep it kind." });

    expect((await api.post("/posts", { kind: "advice", body: "?" })).status).toBe(400); // BE-11 owns advice
  });

  it("comments and kudos on a visible post; moderation applies to comments", async () => {
    const author = await t.as("s-author2");
    const fan = await t.as("s-fan");
    const post = (await author.post("/posts", { kind: "session", body: "Leg day" })).body;

    // Shared posts are public; follows still curate the default feed.
    expect((await fan.get(`/posts/${post.id}/comments`)).status).toBe(200);
    expect((await fan.post("/follows/s-author2")).status).toBe(204);
    expect((await fan.post("/follows/s-author2")).status).toBe(204); // idempotent

    expect((await fan.post(`/posts/${post.id}/kudos`)).status).toBe(204);
    expect((await fan.post(`/posts/${post.id}/kudos`)).status).toBe(204); // idempotent
    const comment = await fan.post(`/posts/${post.id}/comments`, { body: "Nice work!" });
    expect(comment.status).toBe(201);
    expect(comment.body.ai_suggested).toBe(false);
    expect((await fan.post(`/posts/${post.id}/comments`, { body: "forbidden words" })).status).toBe(422);

    const comments = await fan.get(`/posts/${post.id}/comments`);
    expect(comments.body).toHaveLength(1);
    expect(comments.body[0].author.id).toBe("s-fan");

    const feed = await fan.get("/feed");
    const card = feed.body.posts.find((p: { id: string }) => p.id === post.id);
    expect(card).toMatchObject({ kudos_count: 1, comment_count: 1, viewer_gave_kudos: true });
    expect(card.author.id).toBe("s-author2");

    expect((await fan.delete(`/posts/${post.id}/kudos`)).status).toBe(204);
    expect((await fan.delete("/follows/s-author2")).status).toBe(204);
    expect((await fan.get("/feed")).body.posts.find((p: { id: string }) => p.id === post.id)).toBeUndefined();
  });

  it("rejects following yourself or a missing user", async () => {
    const api = await t.as("s-solo");
    expect((await api.post("/follows/s-solo")).status).toBe(400);
    expect((await api.post("/follows/nobody-here")).status).toBe(404);
  });
});

describe("feed", () => {
  it("pages 20 at a time with a keyset cursor, newest first, without gaps or repeats", async () => {
    const author = await t.as("f-author");
    const reader = await t.as("f-reader");
    await author.get("/me/profile"); // first request creates the user
    await reader.post("/follows/f-author");

    // 25 posts, several sharing the same timestamp to exercise the (created_at, id) tie-break.
    const base = Date.UTC(2026, 9, 1);
    await t.db.insert(schema.posts).values(
      Array.from({ length: 25 }, (_, i) => ({
        authorId: "f-author",
        kind: "session" as const,
        body: `post ${i}`,
        createdAt: new Date(base + Math.floor(i / 3) * 1000),
      })),
    );

    const page1 = await reader.get("/feed");
    expect(page1.status).toBe(200);
    expect(page1.body.posts).toHaveLength(20);
    expect(page1.body.next_cursor).toEqual(expect.any(String));

    const page2 = await reader.get(`/feed?cursor=${page1.body.next_cursor}`);
    expect(page2.body.posts).toHaveLength(5);
    expect(page2.body.next_cursor).toBeNull();

    const all = [...page1.body.posts, ...page2.body.posts];
    expect(new Set(all.map((p) => p.id)).size).toBe(25);
    const times = all.map((p) => Date.parse(p.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    expect((await reader.get("/feed?cursor=garbage")).status).toBe(400);
  });

  it("includes beginners at the same gym and hides blocked users", async () => {
    const me = await t.as("g-me");
    const neighbour = await t.as("g-neighbour");
    const pro = await t.as("g-pro");
    const elsewhere = await t.as("g-elsewhere");
    await me.put("/me/profile", { gym_place_id: "gym-1" });
    await neighbour.put("/me/profile", { gym_place_id: "gym-1", experience_level: "beginner" });
    await pro.put("/me/profile", { gym_place_id: "gym-1", experience_level: "advanced" });
    await elsewhere.put("/me/profile", { gym_place_id: "gym-2" });
    for (const [api, body] of [
      [neighbour, "neighbour post"],
      [pro, "pro post"],
      [elsewhere, "elsewhere post"],
    ] as const) {
      await api.post("/posts", { kind: "session", body });
    }

    const bodies = async () => (await me.get("/feed")).body.posts.map((p: { body: string }) => p.body);
    expect(await bodies()).toEqual(["neighbour post"]);

    await t.db.insert(schema.blocks).values({ blockerId: "g-neighbour", blockedId: "g-me" });
    expect(await bodies()).toEqual([]);
  });
});

describe("blocked content", () => {
  it("logs blocked posts and comments with what they targeted", async () => {
    const author = await t.as("m-author");
    const troll = await t.as("m-troll");
    const post = (await author.post("/posts", { kind: "goal", body: "Squat 100" })).body;
    expect((await troll.post("/follows/m-author")).status).toBe(204);

    expect((await troll.post("/posts", { kind: "goal", body: "forbidden post" })).status).toBe(422);
    expect((await troll.post(`/posts/${post.id}/comments`, { body: "forbidden comment" })).status).toBe(422);

    const logged = await t.db
      .select()
      .from(schema.moderationBlocks)
      .where(eq(schema.moderationBlocks.authorId, "m-troll"));
    expect(logged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "post", postId: null, body: "forbidden post", categories: ["S15"] }),
        expect.objectContaining({
          kind: "comment",
          postId: post.id,
          body: "forbidden comment",
          categories: ["S15"],
        }),
      ]),
    );
    expect(logged).toHaveLength(2);
  });

  it("flags self-harm as support and doesn't log it", async () => {
    const api = await t.as("m-support");
    const res = await api.post("/posts", { kind: "goal", body: "I feel hopeless" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "moderation_blocked",
      message: "Call or text 988.",
      details: { support: true },
    });

    const blocked = await api.post("/posts", { kind: "goal", body: "forbidden" });
    expect(blocked.body.details).toBeUndefined();

    const logged = await t.db
      .select()
      .from(schema.moderationBlocks)
      .where(eq(schema.moderationBlocks.authorId, "m-support"));
    expect(logged.map((r) => r.categories)).toEqual([["S15"]]);
  });
});

it("shares a completed session only once across retries and enforces ownership", async () => {
  const api = await t.as("share-retry");
  const session = await api.post("/sessions", { inference_mode: "vision" });
  const path = `/sessions/${session.body.id}/share`;
  const body = { body: "Workout complete.", data: { tier: "bronze" } };
  expect((await api.put(path, body)).status).toBe(409);
  await api.post(`/sessions/${session.body.id}/finish`);
  const first = await api.put(path, body);
  const again = await api.put(path, body);
  expect(first.status).toBe(200);
  expect(again.body.id).toBe(first.body.id);
  expect(
    (await api.get("/feed")).body.posts.filter(
      (p: { session_id: string }) => p.session_id === session.body.id,
    ),
  ).toHaveLength(1);
  expect((await (await t.as("share-stranger")).put(path, body)).status).toBe(404);
});

it("public feed includes historical shared workouts from unfollowed users, never unshared sessions or blocked authors", async () => {
  const author = await t.as("public-workout-author");
  const reader = await t.as("public-workout-reader");
  await author.put("/me/profile", {
    display_name: "Alex",
    experience_level: "advanced",
    gym_place_id: "another-gym",
  });
  await reader.get("/me/profile");
  const session = await author.post("/sessions", { inference_mode: "vision" });
  await author.post(`/sessions/${session.body.id}/finish`);
  const shared = await author.put(`/sessions/${session.body.id}/share`, {
    body: "A stronger leg day.",
    data: { tier: "gold", exercises: [{ name: "Squat", sets: 3, reps: 30 }] },
  });
  expect(shared.status).toBe(200);
  await t.db
    .update(schema.posts)
    .set({ createdAt: new Date("2026-09-01T12:00:00Z") })
    .where(eq(schema.posts.id, shared.body.id));
  const unshared = await author.post("/sessions", { inference_mode: "vision" });
  await author.post(`/sessions/${unshared.body.id}/finish`);
  async function publicPosts() {
    const rows: { id: string; author: { id: string } }[] = [];
    let cursor: string | null = null;
    do {
      const page = await reader.get(
        `/feed?scope=public${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.status).toBe(200);
      rows.push(...page.body.posts);
      cursor = page.body.next_cursor;
    } while (cursor);
    return rows;
  }
  const workouts = (await publicPosts()).filter((p) => p.author.id === "public-workout-author");
  expect(workouts).toHaveLength(1);
  expect(workouts[0]).toMatchObject({
    id: shared.body.id,
    author: { display_name: "Alex" },
    data: { tier: "gold" },
    created_at: "2026-09-01T12:00:00.000Z",
  });
  expect((await reader.post(`/posts/${shared.body.id}/kudos`)).status).toBe(204);
  expect((await reader.post(`/posts/${shared.body.id}/comments`, { body: "Nice progress!" })).status).toBe(
    201,
  );
  await t.db
    .insert(schema.blocks)
    .values({ blockerId: "public-workout-author", blockedId: "public-workout-reader" });
  expect((await publicPosts()).some((p) => p.id === shared.body.id)).toBe(false);
  expect((await reader.post(`/posts/${shared.body.id}/kudos`)).status).toBe(404);
  await t.db.delete(schema.blocks).where(eq(schema.blocks.blockerId, "public-workout-author"));
  await t.db
    .insert(schema.blocks)
    .values({ blockerId: "public-workout-reader", blockedId: "public-workout-author" });
  expect((await publicPosts()).some((p) => p.id === shared.body.id)).toBe(false);
});

it("filters public post types before pagination, including old personal records", async () => {
  const author = await t.as("type-filter-author");
  const reader = await t.as("type-filter-reader");
  await author.get("/me/profile");
  await t.db.insert(schema.posts).values([
    ...Array.from({ length: 25 }, (_, i) => ({
      authorId: "type-filter-author",
      kind: "goal" as const,
      body: `Custom ${i}`,
      data: { post_type: "custom" },
      createdAt: new Date("2026-10-10T12:00:00Z"),
    })),
    {
      authorId: "type-filter-author",
      kind: "pr" as const,
      body: "Squat personal record",
      data: { exercise_id: "squat", value: 20 },
      createdAt: new Date("2026-08-01T12:00:00Z"),
    },
  ]);
  const records = await reader.get("/feed?scope=public&type=pr");
  expect(records.status).toBe(200);
  expect(records.body.posts.map((p: { body: string }) => p.body)).toContain("Squat personal record");
  expect(records.body.posts.every((p: { kind: string }) => p.kind === "pr")).toBe(true);
  expect(
    (await reader.get("/feed?scope=public&type=custom")).body.posts.every((p: { kind: string }) =>
      ["goal", "advice"].includes(p.kind),
    ),
  ).toBe(true);
  expect(
    (await reader.get("/feed?scope=public&type=medal")).body.posts.every((p: { kind: string }) =>
      ["session", "medal"].includes(p.kind),
    ),
  ).toBe(true);
  expect((await reader.get("/feed?scope=public&type=invalid")).status).toBe(400);
});

it("blocks obvious comment abuse without an AI token and removes legacy abusive comments", async () => {
  const api = await t.as("comment-safety");
  const post = (await api.post("/posts", { kind: "goal", body: "A good workout" })).body;
  expect((await api.post(`/posts/${post.id}/comments`, { body: "moderation unavailable" })).status).toBe(503);
  for (const body of ["You're stupid", "go kill yourself", "you are disgusting"]) {
    expect((await api.post(`/posts/${post.id}/comments`, { body })).status).toBe(422);
  }
  expect(
    (await api.post(`/posts/${post.id}/comments`, { body: "My form needs work, but I'm improving" })).status,
  ).toBe(201);
  const [legacy] = await t.db
    .insert(schema.comments)
    .values({ postId: post.id, authorId: "comment-safety", body: "you are worthless" })
    .returning();
  const result = await api.get(`/posts/${post.id}/comments`);
  expect(result.body).toHaveLength(1);
  expect(await t.db.select().from(schema.comments).where(eq(schema.comments.id, legacy.id))).toHaveLength(0);
});
it("stores and moderates a custom post title", async () => {
  const api = await t.as("post-title");
  const saved = await api.post("/posts", { kind: "goal", title: "Leg day", body: "Three solid sets" });
  expect(saved.status).toBe(201);
  expect(saved.body.data.title).toBe("Leg day");
  const override = await api.post("/posts", {
    kind: "goal",
    title: "",
    body: "Friendly text",
    data: { title: "forbidden" },
  });
  expect(override.status).toBe(201);
  expect(override.body.data.title).toBe("");
  expect(
    (await api.post("/posts", { kind: "goal", body: "Friendly text", data: { title: "forbidden" } })).status,
  ).toBe(422);
  expect((await api.post("/posts", { kind: "goal", title: "forbidden", body: "Nice session" })).status).toBe(
    422,
  );
  expect(
    (await api.post("/posts", { kind: "goal", title: "x".repeat(101), body: "Nice session" })).status,
  ).toBe(400);
});
