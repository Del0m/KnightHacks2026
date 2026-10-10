// CONN-08: profile embeddings for buddy matching.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { profileText, type Embed } from "../src/integrations/huggingface/embeddings.js";
import { backfillProfileEmbeddings, profileEmbeddings } from "../src/services/profileEmbeddings.js";
import { createTestDb, setup } from "./helpers.js";

// A fake bge: a unit vector whose position depends on the text, plus a log of what was embedded.
const embedded: string[] = [];
const fakeEmbed: Embed = async (texts) => {
  embedded.push(...texts);
  return texts.map((text) => Array.from({ length: 384 }, (_, i) => (i === text.length % 384 ? 1 : 0)));
};

// Records refreshes from PUT /me/profile; settled resolves once the last one finishes.
let settled: Promise<void> = Promise.resolve();
const refreshed: string[] = [];

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  const { db, close } = await createTestDb();
  const real = profileEmbeddings(db, fakeEmbed);
  t = await setup({
    db,
    close,
    profileEmbeddings: {
      refresh: (userId) => {
        refreshed.push(userId);
        settled = real.refresh(userId);
        return settled;
      },
    },
  });
});
afterAll(() => t.close());

const embeddingOf = async (userId: string) =>
  (await t.db.select({ e: schema.profiles.embedding }).from(schema.profiles).where(eq(schema.profiles.userId, userId)))[0]!.e;

describe("profileText", () => {
  it("uses the app's goal labels and the bio, and is null when both are empty", () => {
    expect(profileText({ goals: ["strength", "legs"], bio: " Powerlifting meet in May " })).toBe(
      "Goals: Build strength, Legs & glutes. About me: Powerlifting meet in May",
    );
    expect(profileText({ goals: [], bio: "Just started" })).toBe("About me: Just started");
    expect(profileText({ goals: null, bio: "  " })).toBeNull();
  });
});

describe("profile embeddings", () => {
  it("re-embeds after goals or bio change, and not for other edits", async () => {
    const api = await t.as("pe-user");
    await api.get("/me/profile"); // creates the user

    expect((await api.put("/me/profile", { goals: ["strength"], bio: "Squat focus" })).status).toBe(200);
    await settled;
    expect(refreshed).toEqual(["pe-user"]);
    expect(embedded.at(-1)).toBe("Goals: Build strength. About me: Squat focus");
    expect(await embeddingOf("pe-user")).toHaveLength(384);

    await api.put("/me/profile", { gym_name: "RWC" });
    expect(refreshed).toEqual(["pe-user"]);

    await api.put("/me/profile", { goals: [], bio: null });
    await settled;
    expect(await embeddingOf("pe-user")).toBeNull();
  });

  it("still saves the profile when embedding fails", async () => {
    const failing = await setup({
      db: t.db,
      profileEmbeddings: { refresh: () => Promise.reject(new Error("hf down")) },
    });
    const api = await failing.as("pe-fail");
    await api.get("/me/profile");
    const res = await api.put("/me/profile", { bio: "Still saved" });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("Still saved");
  });

  it("backfills profiles with goals or a bio and no embedding", async () => {
    for (const id of ["pe-b1", "pe-b2", "pe-empty"]) await (await t.as(id)).get("/me/profile");
    // Written straight to the table, like the demo seed, so nothing was embedded.
    await t.db.update(schema.profiles).set({ goals: ["mobility"] }).where(eq(schema.profiles.userId, "pe-b1"));
    await t.db.update(schema.profiles).set({ bio: "Knee rehab" }).where(eq(schema.profiles.userId, "pe-b2"));

    // pe-fail too: its bio was saved in the previous test but its embedding failed.
    expect(await backfillProfileEmbeddings(t.db, fakeEmbed)).toBe(3);
    expect(await embeddingOf("pe-fail")).toHaveLength(384);
    expect(await embeddingOf("pe-b1")).toHaveLength(384);
    expect(await embeddingOf("pe-b2")).toHaveLength(384);
    expect(await embeddingOf("pe-empty")).toBeNull();
    expect(await backfillProfileEmbeddings(t.db, fakeEmbed)).toBe(0);
  });
});
