// INT-04: posts and comments saved while moderation was unreachable are stored as unchecked and
// re-checked later: kept if allowed, removed (and logged) if blocked.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { runModerationRecheck } from "../src/jobs/recheckModeration.js";
import type { Moderator, ModerationResult } from "../src/services/moderation.js";
import { setup } from "./helpers.js";

// Moderation is "down" while `down` is true; afterwards it blocks "threat"/"hopeless" text.
let down = true;
const moderator: Moderator = {
  async check(text): Promise<ModerationResult> {
    if (down) return { allowed: true, checked: false };
    if (/hopeless/.test(text)) return { allowed: false, message: "988", support: true, categories: ["S11"] };
    if (/threat/.test(text)) return { allowed: false, message: "no threats", categories: ["S15"] };
    return { allowed: true, checked: true };
  },
};

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup({ moderator });
});
afterAll(() => t.close());

const postRow = async (id: string) =>
  (await t.db.select().from(schema.posts).where(eq(schema.posts.id, id)))[0];
const commentRow = async (id: string) =>
  (await t.db.select().from(schema.comments).where(eq(schema.comments.id, id)))[0];
const blocksBy = (authorId: string) =>
  t.db.select().from(schema.moderationBlocks).where(eq(schema.moderationBlocks.authorId, authorId));

describe("moderation re-check", () => {
  it("saves content as unchecked while moderation is down, then keeps or removes it once it's back", async () => {
    down = true;
    const author = await t.as("rc-author");
    const fan = await t.as("rc-fan");
    const fine = (await author.post("/posts", { kind: "goal", body: "Squat 100 by spring" })).body;
    expect(fine.moderation_checked).toBe(false);
    const threat = (await author.post("/posts", { kind: "goal", body: "a veiled threat" })).body;
    const sad = (await author.post("/posts", { kind: "goal", body: "I feel hopeless" })).body;
    await fan.post("/follows/rc-author");
    const comment = (await fan.post(`/posts/${fine.id}/comments`, { body: "a threat in a comment" })).body;
    expect(comment.moderation_checked).toBe(false);

    // Still down: nothing changes, and the run stops early.
    expect(await runModerationRecheck({ db: t.db, moderator })).toEqual({
      checked: 0,
      removed: 0,
      unreachable: true,
    });
    expect((await postRow(fine.id))!.moderationChecked).toBe(false);

    down = false;
    expect(await runModerationRecheck({ db: t.db, moderator })).toEqual({
      checked: 1,
      removed: 3,
      unreachable: false,
    });

    expect((await postRow(fine.id))!.moderationChecked).toBe(true);
    expect(await postRow(threat.id)).toBeUndefined();
    expect(await postRow(sad.id)).toBeUndefined();
    expect(await commentRow(comment.id)).toBeUndefined();

    // Blocks are logged like blocks at posting time; self-harm is removed but never logged.
    expect((await blocksBy("rc-author")).map((b) => [b.kind, b.body, b.categories])).toEqual([
      ["post", "a veiled threat", ["S15"]],
    ]);
    expect((await blocksBy("rc-fan")).map((b) => [b.kind, b.postId, b.categories])).toEqual([
      ["comment", fine.id, ["S15"]],
    ]);

    // Nothing left to re-check.
    expect(await runModerationRecheck({ db: t.db, moderator })).toEqual({
      checked: 0,
      removed: 0,
      unreachable: false,
    });
  });

  it("marks content checked when moderation was up at posting", async () => {
    down = false;
    const api = await t.as("rc-normal");
    const post = (await api.post("/posts", { kind: "goal", body: "3 gold workouts this month" })).body;
    expect(post.moderation_checked).toBe(true);
  });
});
