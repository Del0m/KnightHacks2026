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
//
// Threats and harassment (S15, S16): Llama Guard returns safe for direct threats ("I'm going to
// find you after the gym and hurt you") and personal insults ("you're a fat useless pig"); S1
// covers enabling violent crimes, S10 only hate against protected groups. DeepInfra also ignores
// custom categories (both chat_template_kwargs and a hand-built prompt came back safe). So posts
// and comments get a second check on the CONN-07 gpt-oss chain, run alongside Llama Guard, that
// adds these two custom categories. ~0.2-0.4 s on cerebras. unitary/toxic-bert was tried and
// rejected: "I'm going to destroy legs today" scores higher on threat than "watch your back".
// Advice isn't shown to other members, so it skips this check.
//
// If either check can't be reached the content is allowed with checked: false, so posting keeps
// working during an outage; callers should store that flag and re-check or review later.

import { InferenceClient } from "@huggingface/inference";
import type { Env } from "../../env.js";
import type { HfLlm } from "./llm.js";

export type ContentKind = "post" | "comment" | "advice";

export interface ModerationResult {
  allowed: boolean;
  checked: boolean; // false when Llama Guard couldn't be reached (allowed by default)
  categories: string[]; // Llama Guard codes plus our S15/S16, e.g. ["S6"]
  message?: string; // friendly text to show when not allowed
  advisory?: "specialized_advice";
  support?: boolean; // self-harm: show support resources, not a block
}

// MLCommons hazard categories used by Llama Guard 4, plus S15/S16 from the personal check.
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
  S15: "threats",
  S16: "harassment",
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
  S15: "Let's keep Spotter a safe place to train. Posts that threaten or keep tabs on other members can't be shared.",
  S16: "Spotter is for lifting each other up. Please don't post insults, put-downs or unwanted comments aimed at someone.",
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

type ModerationEnv = Pick<Env, "HF_TOKEN" | "HF_GUARD_MODEL" | "HF_GUARD_PROVIDER" | "HF_GUARD_TIMEOUT_MS">;

/** From the validated env (src/env.ts); scripts can pass process.env. */
export function moderationConfigFromEnv(env: ModerationEnv = process.env): ModerationConfig {
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

// ---- Threats and harassment (S15, S16) ----

export const PERSONAL_SYSTEM = `You moderate posts and comments on Spotter, a gym social app. Classify the text, read as written to another member:
- "threat": a real threat to hurt, stalk, follow, or intimidate a person, explicit or veiled ("watch your back", "I know where you live", "I'll be waiting by your car"). This includes letting someone know you've been watching them or tracking their schedule or whereabouts when it's unsolicited or suggestive ("saw you at the 6am class, you go every day right? 😉").
- "harassment": abuse aimed at a person: degrading name-calling, body-shaming, slurs, or telling them they're unwanted or should quit or leave. This includes sexual harassment: sexual or suggestive comments about someone's body or how they look working out, unwanted advances or flirting, and pressure to meet up or share contact details.
- "none": everything else. This includes plain friendly plans between members ("great class today, see you Thursday!"), compliments on effort or progress ("your squat depth has improved so much"), gym slang ("destroy legs", "this set killed me"), self-deprecation, obvious joking exaggeration between gym friends ("skip leg day again and I'll kill you 😂"), playful trash talk ("light weight baby", "you lift like my grandma"), and blunt or rude feedback about a lift or form ("your form is trash").
When it's unclear whether something is a joke or a real threat, choose "threat".`;

const PERSONAL_SCHEMA = {
  type: "object" as const,
  properties: { category: { type: "string" as const, enum: ["threat", "harassment", "none"] } },
  required: ["category"],
  additionalProperties: false,
};

const PERSONAL_CODES: Record<string, string[]> = { threat: ["S15"], harassment: ["S16"], none: [] };

// ---- Client ----

const MAX_CHARS = 8000;

function isRetryable(err: unknown): boolean {
  const status = (err as { httpResponse?: { status?: number } })?.httpResponse?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

// Console or pino: both take a plain message.
export interface LogLike {
  warn(msg: string): void;
}

export class Moderator {
  private readonly client: InferenceClient;

  constructor(
    private readonly config: ModerationConfig,
    client?: InferenceClient,
    private readonly log: LogLike = console,
    // CONN-07 client for the S15/S16 check; without it only Llama Guard runs.
    private readonly llm: Pick<HfLlm, "generateJson"> | null = null,
  ) {
    this.client = client ?? new InferenceClient(config.token);
  }

  /** Never throws. Fails open (allowed, checked: false) if a check is unreachable. */
  async moderate(text: string, kind: ContentKind): Promise<ModerationResult> {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content) return { allowed: true, checked: true, categories: [] };

    const deadline = Date.now() + this.config.timeoutMs;
    const [guard, personal] = await Promise.all([
      this.llamaGuard(content, kind, deadline),
      kind === "advice" ? Promise.resolve([]) : this.personal(content, kind, deadline),
    ]);
    const result = applyPolicy([...(guard ?? []), ...(personal ?? [])]);
    return guard && personal ? result : { ...result, checked: false };
  }

  /** Llama Guard's categories, or null if it couldn't be reached. */
  private async llamaGuard(content: string, kind: ContentKind, deadline: number): Promise<string[] | null> {
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
        return parseVerdict(res.choices?.[0]?.message?.content ?? "");
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) break;
      }
    }

    this.log.warn(`[moderation] ${kind} not checked by Llama Guard, allowing: ${(lastError as Error)?.message ?? "deadline exceeded"}`);
    return null;
  }

  /** S15/S16 from the gpt-oss check, [] when there's no LLM, or null if it couldn't be reached. */
  private async personal(content: string, kind: ContentKind, deadline: number): Promise<string[] | null> {
    if (!this.llm) return [];
    try {
      const { data } = await this.llm.generateJson<{ category: string }>({
        schema: PERSONAL_SCHEMA,
        schemaName: "moderation",
        system: PERSONAL_SYSTEM,
        user: content,
        timeoutMs: Math.max(0, deadline - Date.now()),
        maxTokens: 300,
        temperature: 0,
      });
      return PERSONAL_CODES[data.category] ?? [];
    } catch (err) {
      this.log.warn(`[moderation] ${kind} not checked for threats/harassment, allowing: ${(err as Error).message}`);
      return null;
    }
  }
}
