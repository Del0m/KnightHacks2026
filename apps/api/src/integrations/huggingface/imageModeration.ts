// Feed photos through Llama Guard 4, which reads images as well as text (CONN-09's model and
// provider, HF_GUARD_*). The verdict goes through the same policy as text (applyPolicy): S11 is a
// support message, S6 is allowed, anything else unsafe is blocked with that category's message.
//
// The provider fetches the image itself from a short-lived signed R2 URL. If Llama Guard can't be
// reached the result is checked: false, and the caller refuses the post (photos fail closed, like
// comments in FE-11) rather than showing an unchecked image. Videos aren't sent here: they can't
// be checked automatically, so they rely on member reports (routes/media.ts).
import { InferenceClient } from "@huggingface/inference";
import { applyPolicy, parseVerdict, type ModerationConfig, type ModerationResult } from "./moderation.js";

export type ImageChecker = (imageUrl: string) => Promise<ModerationResult>;

export interface LogLike {
  warn(msg: string): void;
}

export function llamaGuardImageChecker(
  config: ModerationConfig,
  client: Pick<InferenceClient, "chatCompletion"> = new InferenceClient(config.token),
  log: LogLike = { warn: () => {} },
): ImageChecker {
  return async (imageUrl) => {
    const deadline = Date.now() + config.timeoutMs * 2; // images take longer than text
    let lastError: unknown;
    for (let attempt = 1; attempt <= config.attempts; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const res = await client.chatCompletion(
          {
            model: config.model,
            provider: config.provider as never,
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }] }],
            max_tokens: 20,
            temperature: 0,
          },
          { signal: AbortSignal.timeout(remaining), retry_on_error: false },
        );
        return applyPolicy(parseVerdict(res.choices?.[0]?.message?.content ?? ""));
      } catch (err) {
        lastError = err;
      }
    }
    log.warn(`[moderation] image not checked: ${(lastError as Error)?.message ?? "deadline exceeded"}`);
    return { allowed: true, checked: false, categories: [] };
  };
}
