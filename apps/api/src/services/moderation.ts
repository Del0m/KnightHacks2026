// Moderation port for posts, comments and advice (BE-10, §12).
//
// In production this is CONN-09's Llama Guard client (integrations/huggingface/moderation.ts),
// adapted below and wired in src/index.ts when HF_TOKEN is set. Without a token, and in tests,
// everything is allowed.
import type { Moderator as LlamaGuard } from "../integrations/huggingface/moderation.js";

export type ModerationResult = { allowed: true } | { allowed: false; message: string };

export interface Moderator {
  check(text: string, kind: "post" | "comment" | "advice"): Promise<ModerationResult>;
}

export const allowAllModerator: Moderator = {
  async check() {
    return { allowed: true };
  },
};

export const BLOCKED_MESSAGE =
  "This couldn't be posted because it may break the community guidelines. Try rewording it.";

// Llama Guard fails open when unreachable (allowed, checked: false), so posting keeps working.
export function llamaGuardModerator(guard: Pick<LlamaGuard, "moderate">): Moderator {
  return {
    async check(text, kind) {
      const result = await guard.moderate(text, kind);
      return result.allowed
        ? { allowed: true }
        : { allowed: false, message: result.message ?? BLOCKED_MESSAGE };
    },
  };
}
