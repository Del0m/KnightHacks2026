// CONN-07: shared gpt-oss client with JSON-schema output (Architecture §10).
// Used by rest notes (AI-11), the planner (BE-08) and advice answers (BE-11).
//
//   const { data } = await llm.generateJson({ schema, schemaName: "rest_note", system, user, timeoutMs: 1500 });
//
// Tries each model:provider pair in HF_LLM_CHAIN in order. Each pair gets a couple of attempts
// (retrying rate limits, provider errors, timeouts and replies that don't match the schema),
// all inside one overall deadline. Throws LlmError when nothing works, so callers can fall back
// to their template text.

import { InferenceClient } from "@huggingface/inference";
import type { Env } from "../../env.js";

// Tested 2026-10-10 with a strict rest-note schema, best first:
//   120b@cerebras ~0.6 s warm (6 s cold), 120b@together 1-2.5 s, 20b@groq ~0.7 s.
// Also valid but slower: 120b on novita, nscale, deepinfra (2-8.5 s).
// Don't use: 120b@groq returns HTTP 400 for json_schema; fireworks-ai needs pay-as-you-go.
export const DEFAULT_CHAIN = "openai/gpt-oss-120b:cerebras,openai/gpt-oss-120b:together,openai/gpt-oss-20b:groq";

export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
  description?: string;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
};

export interface GenerateJsonInput {
  schema: JsonSchema; // root must be an object
  schemaName: string; // [a-z0-9_]
  system: string;
  user: string;
  timeoutMs?: number; // overall deadline across every attempt
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateJsonResult<T> {
  data: T;
  model: string;
  provider: string;
  attempts: number;
  latency_ms: number;
  failures: string[]; // earlier attempts that didn't work, for logging
}

export class LlmError extends Error {
  constructor(message: string, readonly failures: string[]) {
    super(`${message}: ${failures.join(" | ")}`);
    this.name = "LlmError";
  }
}

// ---- Config ----

export interface LlmConfig {
  token: string;
  chain: { model: string; provider: string }[];
  attemptsPerPair: number;
  defaultTimeoutMs: number;
}

type LlmEnv = Pick<Env, "HF_TOKEN" | "HF_LLM_CHAIN" | "HF_LLM_ATTEMPTS" | "HF_LLM_TIMEOUT_MS">;

/** From the validated env (src/env.ts); scripts can pass process.env. */
export function llmConfigFromEnv(env: LlmEnv = process.env): LlmConfig {
  if (!env.HF_TOKEN) throw new Error("Missing env for Hugging Face: HF_TOKEN");
  const chain = (env.HF_LLM_CHAIN || DEFAULT_CHAIN).split(",").map((pair) => {
    const i = pair.lastIndexOf(":");
    if (i <= 0) throw new Error(`HF_LLM_CHAIN entries must be model:provider, got "${pair}"`);
    return { model: pair.slice(0, i).trim(), provider: pair.slice(i + 1).trim() };
  });
  return {
    token: env.HF_TOKEN,
    chain,
    attemptsPerPair: Number(env.HF_LLM_ATTEMPTS) || 2,
    defaultTimeoutMs: Number(env.HF_LLM_TIMEOUT_MS) || 20_000,
  };
}

// ---- Output checks ----

// Some providers treat the schema as a hint, so check the reply ourselves. Covers the subset
// of JSON Schema our prompts use; returns the first problem found, or null.
export function schemaProblem(value: unknown, schema: JsonSchema, path = "$"): string | null {
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${JSON.stringify(schema.enum)}`;
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path} must be an object`;
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!(key in obj)) return `${path}.${key} is missing`;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) {
          const problem = schemaProblem(obj[key], sub, `${path}.${key}`);
          if (problem) return problem;
        }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs ${schema.minItems}+ items`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} allows ${schema.maxItems} items`;
      for (let i = 0; i < value.length; i++) {
        const problem = schema.items ? schemaProblem(value[i], schema.items, `${path}[${i}]`) : null;
        if (problem) return problem;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") return `${path} must be a string`;
      return schema.maxLength !== undefined && value.length > schema.maxLength ? `${path} is too long` : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a number`;
    case "integer":
      return Number.isInteger(value) ? null : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "null":
      return value === null ? null : `${path} must be null`;
    default:
      return null;
  }
}

function parseJson(content: string): unknown {
  // Tolerate ```json fences or a sentence around the object.
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("reply was not JSON");
  }
}

// ---- Client ----

class BadOutput extends Error {}

function statusOf(err: unknown): number | undefined {
  return (err as { httpResponse?: { status?: number } })?.httpResponse?.status;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof BadOutput) return true;
  const status = statusOf(err);
  if (status === undefined) return true; // network error or per-attempt timeout
  return status === 408 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HfLlm {
  private readonly client: InferenceClient;

  constructor(
    private readonly config: LlmConfig,
    client?: InferenceClient,
  ) {
    this.client = client ?? new InferenceClient(config.token);
  }

  async generateJson<T>(input: GenerateJsonInput): Promise<GenerateJsonResult<T>> {
    const started = Date.now();
    const deadline = started + (input.timeoutMs ?? this.config.defaultTimeoutMs);
    const failures: string[] = [];
    let attempts = 0;

    for (const { model, provider } of this.config.chain) {
      for (let attempt = 1; attempt <= this.config.attemptsPerPair; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new LlmError("LLM deadline exceeded", failures);
        attempts++;
        try {
          const data = await this.once<T>(model, provider, input, remaining);
          return { data, model, provider, attempts, latency_ms: Date.now() - started, failures };
        } catch (err) {
          const status = statusOf(err);
          failures.push(`${model}@${provider}#${attempt}: ${status ? `HTTP ${status} ` : ""}${(err as Error).message.slice(0, 160)}`);
          if (!isRetryable(err)) break; // e.g. 400/401/403/404: this pair won't work, try the next
          if (attempt < this.config.attemptsPerPair) await sleep(Math.min(250 * attempt, Math.max(0, deadline - Date.now())));
        }
      }
    }
    throw new LlmError("No model/provider produced valid JSON", failures);
  }

  private async once<T>(model: string, provider: string, input: GenerateJsonInput, timeoutMs: number): Promise<T> {
    const res = await this.client.chatCompletion(
      {
        model,
        provider: provider as never,
        messages: [
          // "Reasoning: low" is gpt-oss's own switch for short thinking; keeps latency down.
          { role: "system", content: `Reasoning: low\n\n${input.system}` },
          { role: "user", content: input.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: input.schemaName, schema: input.schema, strict: true },
        },
        max_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.3,
      },
      { signal: AbortSignal.timeout(timeoutMs), retry_on_error: false },
    );

    const content = res.choices?.[0]?.message?.content;
    if (!content) throw new BadOutput("empty reply");
    let data: unknown;
    try {
      data = parseJson(content);
    } catch (err) {
      throw new BadOutput((err as Error).message);
    }
    const problem = schemaProblem(data, input.schema);
    if (problem) throw new BadOutput(`reply didn't match schema: ${problem}`);
    return data as T;
  }
}
