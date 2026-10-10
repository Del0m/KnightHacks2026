// BE-09 feed and BE-10 social writes.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import type { Moderator } from "../src/services/moderation.js";
import { setup } from "./helpers.js";

const moderator: Moderator = {
  async check(text) {
    if (/hopeless/i.test(text)) return { allowed: false, message: "Call or text 988.", support: true, categories: ["S11"] };
    if (/forbidden/i.test(text)) return { allowed: false, message: "Please keep it kind.", categories: ["S15"] };
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

    // Not visible until fan follows author.
    expect((await fan.post(`/posts/${post.id}/kudos`)).status).toBe(404);
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
        expect.objectContaining({ kind: "comment", postId: post.id, body: "forbidden comment", categories: ["S15"] }),
      ]),
    );
    expect(logged).toHaveLength(2);
  });

  it("flags self-harm as support and doesn't log it", async () => {
    const api = await t.as("m-support");
    const res = await api.post("/posts", { kind: "goal", body: "I feel hopeless" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "moderation_blocked", message: "Call or text 988.", details: { support: true } });

    const blocked = await api.post("/posts", { kind: "goal", body: "forbidden" });
    expect(blocked.body.details).toBeUndefined();

    const logged = await t.db
      .select()
      .from(schema.moderationBlocks)
      .where(eq(schema.moderationBlocks.authorId, "m-support"));
    expect(logged.map((r) => r.categories)).toEqual([["S15"]]);
  });
});
