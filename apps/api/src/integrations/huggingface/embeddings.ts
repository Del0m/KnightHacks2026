// CONN-08: profile embeddings for buddy matching (BE-12, Architecture §12).
//
//   const [vector] = await embed([profileText(profile)]);
//
// Same model as the RAG ingest and the planner's query embedder (embed.ts, whose test checks it
// against rag/ingest.ts). Profiles are compared with each other, so both sides are embedded as
// passages, without bge's query prefix.

import { InferenceClient } from "@huggingface/inference";
import { EMBED_DIM, EMBED_MODEL } from "./embed.js";

export type Embed = (texts: string[]) => Promise<number[][]>;

// Onboarding goal ids with the labels the app shows (apps/mobile/src/screens/Onboarding/model.ts),
// so the model sees "Build strength" rather than "strength".
const GOAL_LABELS: Record<string, string> = {
  muscle: "Increase muscle",
  weight: "Lose weight",
  strength: "Build strength",
  endurance: "Improve endurance",
  mobility: "Improve mobility",
  consistency: "Stay consistent",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
  legs: "Legs & glutes",
};

/** The text a profile is embedded from: goals and bio. Null when there's nothing to embed. */
export function profileText(profile: { goals: string[] | null; bio: string | null }): string | null {
  const goals = (profile.goals ?? []).map((g) => GOAL_LABELS[g] ?? g);
  const bio = profile.bio?.trim();
  const parts = [goals.length ? `Goals: ${goals.join(", ")}.` : "", bio ? `About me: ${bio}` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function hfEmbedder(token: string, client = new InferenceClient(token)): Embed {
  return async (texts) => {
    const out = (await client.featureExtraction(
      { model: EMBED_MODEL, provider: "hf-inference", inputs: texts },
      { signal: AbortSignal.timeout(20_000) },
    )) as number[][];
    if (out.length !== texts.length || out.some((v) => v.length !== EMBED_DIM)) {
      throw new Error(`expected ${texts.length} x ${EMBED_DIM} embeddings`);
    }
    return out;
  };
}
