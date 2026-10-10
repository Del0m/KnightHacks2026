// Moderation port for posts, comments and advice (BE-10, §12).
//
// In production this is CONN-09's Llama Guard client (integrations/huggingface/moderation.ts),
// adapted below and wired in src/index.ts when HF_TOKEN is set. Without a token, and in tests,
// everything is allowed.
import type { Moderator as LlamaGuard } from "../integrations/huggingface/moderation.js";

// Extra fields from Llama Guard, for routes that need them (all optional):
//   advisory  allowed, but asks for specialized (e.g. medical) advice: BE-11 should point to a
//             professional rather than answer with AI
//   checked   false when Llama Guard was unreachable and the text was allowed unchecked
//   support   self-harm: show support resources rather than a plain block
export type ModerationResult =
  | { allowed: true; advisory?: "specialized_advice"; checked?: boolean }
  | { allowed: false; message: string; support?: boolean };

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
      if (result.allowed) {
        return {
          allowed: true,
          checked: result.checked,
          ...(result.advisory ? { advisory: result.advisory } : {}),
        };
      }
      return {
        allowed: false,
        message: result.message ?? BLOCKED_MESSAGE,
        ...(result.support ? { support: true } : {}),
      };
    },
  };
}
