// BE-11: POST /advice with AI-13's writer, pgvector retrieval and the stored first answer.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as rag from "../../../rag/ingest.js";
import { schema } from "../src/db.js";
import type { GenerateJsonInput } from "../src/integrations/huggingface/llm.js";
import { ADVICE_DISCLAIMER, AdviceWriter, PAIN_REPLY } from "../src/services/advice.js";
import { chunkSource } from "../src/services/adviceThread.js";
import type { Moderator } from "../src/services/moderation.js";
import { createTestDb, setup } from "./helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Bag of words hashed into 384 dimensions: texts that share words are close.
function fakeVector(text: string): number[] {
  const v = new Array<number>(384).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 7;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 384]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const squat = {
  id: "Bodyweight_Squat",
  name: "Bodyweight Squat",
  force: "push",
  level: "beginner",
  mechanic: "compound",
  equipment: "body only",
  primaryMuscles: ["quadriceps"],
  secondaryMuscles: ["glutes"],
  instructions: ["Stand with feet shoulder width apart and sit back into a squat."],
  category: "strength",
};

// gpt-oss stand-in: answers from the first source it is shown, and the claim check agrees.
// A question containing "deep" is declined, so that thread has no AI answer.
const calls: GenerateJsonInput[] = [];
const llm = {
  generateJson: async <T>(input: GenerateJsonInput) => {
    calls.push(input);
    const payload = JSON.parse(input.user) as {
      question?: string;
      sources: { id: string }[];
      sentences?: string[];
    };
    const data =
      input.schemaName === "advice_verify"
        ? { supported: payload.sentences!.map(() => true) }
        : /deep/.test(payload.question ?? "")
          ? { answerable: false, answer: "", source_ids: [] }
          : {
              answerable: true,
              answer: "The bodyweight squat is listed as a beginner strength exercise.",
              source_ids: [payload.sources[0]!.id],
            };
    return { data: data as T, model: "fake", provider: "fake", attempts: 1, latency_ms: 1, failures: [] };
  },
};

const blockSteroids: Moderator = {
  check: async (text) =>
    /steroid/i.test(text)
      ? { allowed: false, message: "We can't share posts about illegal activity.", categories: ["S2"] }
      : { allowed: true },
};

describe("POST /advice", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    const created = await createTestDb();
    t = await setup({
      db: created.db,
      close: created.close,
      moderator: blockSteroids,
      advice: { writer: new AdviceWriter(llm), embed: async (q) => fakeVector(q) },
    });
    const note = rag.parseNote("knee.md", readFileSync(path.join(ROOT, "rag/notes/knee.md"), "utf8"));
    await rag.ingest(created.client, async (texts) => texts.map(fakeVector), [
      rag.exerciseChunk(squat),
      ...rag.noteChunks(note),
    ]);
  });
  afterAll(() => t.close());

  it("posts the question with an AI-suggested first answer that cites its sources", async () => {
    const me = await t.as("a-asker");
    calls.length = 0;
    const res = await me.post("/advice", {
      body: "What muscles does a bodyweight squat work for a beginner?",
    });
    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({ kind: "advice", author_id: "a-asker" });
    expect(res.body.post).not.toHaveProperty("embedding");
    expect(res.body.outcome).toBe("ai");
    expect(res.body.reply).toMatchObject({
      author_id: null, // posted by SteadyForum
      ai_suggested: true,
      body: `The bodyweight squat is listed as a beginner strength exercise. ${ADVICE_DISCLAIMER}`,
      sources: [
        {
          id: "exercise:Bodyweight_Squat#0",
          kind: "exercise",
          title: "Bodyweight Squat",
          url: expect.stringMatching(/^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\//),
          post_id: null,
        },
      ],
    });
    expect(calls.map((c) => c.schemaName)).toEqual(["advice_answer", "advice_verify"]);

    // The thread shows the answer and its sources; the question is in the feed.
    const thread = await me.get(`/posts/${res.body.post.id}/comments`);
    expect(thread.body).toEqual([
      expect.objectContaining({ ai_suggested: true, author: null, sources: res.body.reply.sources }),
    ]);
    const feed = await me.get("/feed");
    expect(feed.body.posts[0]).toMatchObject({ id: res.body.post.id, kind: "advice" });
    const [stored] = await t.db.select().from(schema.posts).where(eq(schema.posts.id, res.body.post.id));
    expect(stored!.embedding).toHaveLength(384);
  });

  it("gives the fixed reply to a question that mentions pain, without calling the model", async () => {
    calls.length = 0;
    const res = await (
      await t.as("a-pain")
    ).post("/advice", { body: "My knee hurts when I squat, what can I do?" });
    expect(res.body).toMatchObject({
      outcome: "fixed_pain",
      reply: { body: PAIN_REPLY, ai_suggested: false, author_id: null, sources: null },
    });
    expect(calls).toEqual([]);
  });

  it("uses community answers to similar questions the asker can see, never from blocked users", async () => {
    const question = "How deep should a bodyweight squat go for a beginner?";
    const first = await (await t.as("a-first")).post("/advice", { body: question });
    expect(first.body).toMatchObject({ outcome: "none", reason: "not_answerable", reply: null });
    const postId = first.body.post.id;

    for (const [helper, body] of [
      ["a-helper", "Hips level with the knees works well for most beginners."],
      ["a-rude", "Go as deep as you like."],
    ]) {
      const h = await t.as(helper);
      await h.post(`/follows/a-first`);
      expect((await h.post(`/posts/${postId}/comments`, { body })).status).toBe(201);
    }

    const asker = await t.as("a-second");
    await asker.post("/follows/a-first"); // so the first question is visible to them
    await t.db.insert(schema.blocks).values({ blockerId: "a-second", blockedId: "a-rude" });
    calls.length = 0;
    await asker.post("/advice", { body: `${question} Asking for a friend.` });
    const shown = JSON.parse(calls[0]!.user) as { sources: { id: string; kind: string; title: string }[] };
    const community = shown.sources.filter((s) => s.kind === "community_answer");
    expect(community).toEqual([expect.objectContaining({ title: `Community answer to "${question}"` })]);

    // Someone who can't see the first question doesn't get its answers.
    calls.length = 0;
    await (await t.as("a-stranger")).post("/advice", { body: `${question} Asking for a friend.` });
    const strangerSources = (JSON.parse(calls[0]!.user) as { sources: { kind: string }[] }).sources;
    expect(strangerSources.some((s) => s.kind === "community_answer")).toBe(false);
  });

  it("moderates the question like a post and saves nothing when it's blocked", async () => {
    const res = await (await t.as("a-blocked")).post("/advice", { body: "Where can I buy steroids?" });
    expect(res.status).toBe(422);
    expect(await t.db.select().from(schema.posts).where(eq(schema.posts.authorId, "a-blocked"))).toEqual([]);
    const [logged] = await t.db
      .select()
      .from(schema.moderationBlocks)
      .where(eq(schema.moderationBlocks.authorId, "a-blocked"));
    expect(logged).toMatchObject({ kind: "post", categories: ["S2"] });
    expect((await (await t.as("a-blocked")).post("/advice", { body: "  " })).status).toBe(400);
  });

  it("never cites team-guidance note sections", () => {
    expect(
      chunkSource({
        id: "n#1",
        content: "x",
        metadata: { kind: "injury_note", team_guidance: true, sources: [] },
      }),
    ).toBeNull();
    expect(
      chunkSource({
        id: "n#0",
        content: "x",
        metadata: {
          kind: "injury_note",
          title: "Knee",
          section: "Limit or avoid",
          sources: ["https://www.nhs.uk/a"],
          team_guidance: false,
        },
      }),
    ).toEqual({
      id: "n#0",
      kind: "injury_note",
      title: "Knee: Limit or avoid",
      content: "x",
      url: "https://www.nhs.uk/a",
    });
  });
});

describe("POST /advice without HF_TOKEN", () => {
  it("still posts the question, with no AI answer", async () => {
    const t = await setup();
    const res = await (await t.as("n-asker")).post("/advice", { body: "Is a squat good for beginners?" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: "none", reason: "no_sources", reply: null });
    const pain = await (await t.as("n-asker")).post("/advice", { body: "My shoulder hurts after pressing" });
    expect(pain.body.outcome).toBe("fixed_pain"); // needs no model
    await t.close();
  });
});
