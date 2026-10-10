// CONN-09: moderate posts, comments and advice with Llama Guard 4 before they're saved.
//
//   const result = await moderator.moderate(text, "advice");
//   if (!result.allowed) return res.status(422).json({ message: result.message });
//
// Llama Guard replies "safe" or "unsafe\nS1,S6". Policy on top of that:
//   S6 (specialized advice)  allowed. Most advice questions ("my knee hurts, should I rest?")
//                            land here. Returned as advisory: "specialized_advice" so the advice
//                            flow (BE-11) points to a professional instead of an AI medical answer.
//   S11 (self-harm)          kept out of the feed; the user gets a supportive message with 988.
//   anything else unsafe     blocked with a friendly message for that kind of content.
//
// Tested 2026-10-10: DeepInfra is the only live provider for Llama-Guard-4-12B, ~0.3-0.5 s.
// Known gap: Llama Guard doesn't flag personal insults or body-shaming ("you're a fat useless
// pig" comes back safe); it only covers hate against protected groups. Block/report covers it.
//
// If Llama Guard can't be reached the content is allowed with checked: false, so posting keeps
// working during an outage; callers should store that flag and re-check or review later.
//
// Stub until BE-01: env is read directly; move to the Zod env.

import { InferenceClient } from "@huggingface/inference";

export type ContentKind = "post" | "comment" | "advice";

export interface ModerationResult {
  allowed: boolean;
  checked: boolean; // false when Llama Guard couldn't be reached (allowed by default)
  categories: string[]; // Llama Guard codes, e.g. ["S6"]
  message?: string; // friendly text to show when not allowed
  advisory?: "specialized_advice";
  support?: boolean; // self-harm: show support resources, not a block
}

// MLCommons hazard categories used by Llama Guard 4.
export const CATEGORY_NAMES: Record<string, string> = {
  S1: "violent crimes",
  S2: "non-violent crimes",
  S3: "sex-related crimes",
  S4: "child sexual exploitation",
  S5: "defamation",
  S6: "specialized advice",
  S7: "privacy",
  S8: "intellectual property",
  S9: "indiscriminate weapons",
  S10: "hate",
  S11: "suicide and self-harm",
  S12: "sexual content",
  S13: "elections",
  S14: "code interpreter abuse",
};

const SUPPORT_MESSAGE =
  "It sounds like you're going through a lot right now, and you don't have to deal with it alone. " +
  "If you're in the US, you can call or text 988 any time to talk to someone. This post wasn't shared.";

const MESSAGES: Record<string, string> = {
  S1: "Let's keep Spotter a safe place to train. Posts about hurting people can't be shared.",
  S2: "We can't share posts about illegal activity, like buying drugs or steroids without a prescription.",
  S3: "This can't be shared on Spotter.",
  S4: "This can't be shared on Spotter.",
  S5: "Please don't post claims that could damage someone's reputation.",
  S7: "Please keep personal details like addresses, phone numbers or someone's location out of your posts.",
  S8: "Please only share content you have the rights to.",
  S9: "This can't be shared on Spotter.",
  S10: "Spotter is for everyone. Please keep posts free of hateful language.",
  S12: "Please keep posts gym-friendly and free of sexual content.",
  S13: "Spotter is for training talk, so please keep election content elsewhere.",
  S14: "This can't be shared on Spotter.",
};
const DEFAULT_MESSAGE = "This doesn't fit Spotter's community guidelines. Try rewording it and posting again.";

// ---- Config ----

export interface ModerationConfig {
  token: string;
  model: string;
  provider: string;
  timeoutMs: number;
  attempts: number;
}

export function moderationConfigFromEnv(env = process.env): ModerationConfig {
  if (!env.HF_TOKEN) throw new Error("Missing env for Hugging Face: HF_TOKEN");
  return {
    token: env.HF_TOKEN,
    model: env.HF_GUARD_MODEL || "meta-llama/Llama-Guard-4-12B",
    provider: env.HF_GUARD_PROVIDER || "deepinfra",
    timeoutMs: Number(env.HF_GUARD_TIMEOUT_MS) || 5000,
    attempts: 2,
  };
}

// ---- Verdicts ----

/** Parses "safe" / "unsafe\nS1,S6" into category codes ([] when safe). Throws on anything else. */
export function parseVerdict(raw: string): string[] {
  const lines = raw.trim().split(/\s*\n\s*/);
  if (lines[0] === "safe") return [];
  if (lines[0] === "unsafe") return (lines[1] ?? "").split(/[,\s]+/).filter((c) => /^S\d+$/.test(c));
  throw new Error(`unexpected Llama Guard reply: ${JSON.stringify(raw.slice(0, 80))}`);
}

export function applyPolicy(categories: string[]): ModerationResult {
  if (categories.includes("S11")) {
    return { allowed: false, checked: true, categories, support: true, message: SUPPORT_MESSAGE };
  }
  const blocking = categories.filter((c) => c !== "S6");
  if (blocking.length) {
    return { allowed: false, checked: true, categories, message: MESSAGES[blocking[0]] ?? DEFAULT_MESSAGE };
  }
  return categories.includes("S6")
    ? { allowed: true, checked: true, categories, advisory: "specialized_advice" }
    : { allowed: true, checked: true, categories };
}

// ---- Client ----

const MAX_CHARS = 8000;

function isRetryable(err: unknown): boolean {
  const status = (err as { httpResponse?: { status?: number } })?.httpResponse?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export class Moderator {
  private readonly client: InferenceClient;

  constructor(
    private readonly config: ModerationConfig,
    client?: InferenceClient,
  ) {
    this.client = client ?? new InferenceClient(config.token);
  }

  /** Never throws. Fails open (allowed, checked: false) if Llama Guard is unreachable. */
  async moderate(text: string, kind: ContentKind): Promise<ModerationResult> {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content) return { allowed: true, checked: true, categories: [] };

    const deadline = Date.now() + this.config.timeoutMs;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.attempts; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const res = await this.client.chatCompletion(
          {
            model: this.config.model,
            provider: this.config.provider as never,
            messages: [{ role: "user", content }],
            max_tokens: 20,
            temperature: 0,
          },
          { signal: AbortSignal.timeout(remaining), retry_on_error: false },
        );
        return applyPolicy(parseVerdict(res.choices?.[0]?.message?.content ?? ""));
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) break;
      }
    }

    console.warn(`[moderation] ${kind} not checked, allowing: ${(lastError as Error)?.message ?? "deadline exceeded"}`);
    return { allowed: true, checked: false, categories: [] };
  }
}
