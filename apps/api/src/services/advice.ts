// AI-13: AI-suggested first answer to an advice question. Not implemented yet: the interface
// matches docs/superpowers/specs/2026-10-10-advice-answer-design.md.
import type { HfLlm } from "../integrations/huggingface/llm.js";

export type AdviceSourceKind = "community_answer" | "injury_note" | "exercise";

export interface AdviceSource {
  id: string;
  kind: AdviceSourceKind;
  title: string;
  content: string;
  url?: string | null;
  post_id?: string | null;
}

export interface AdviceInput {
  question: string;
  sources: AdviceSource[];
}

export type AdviceNoneReason =
  "empty_question" | "no_sources" | "llm_unavailable" | "llm_failed" | "not_answerable" | "guard_rejected";

export type AdviceAnswer =
  | { kind: "ai"; text: string; sources: AdviceSource[] }
  | { kind: "fixed_pain"; text: string; signals: string[] }
  | { kind: "none"; reason: AdviceNoneReason };

export const PAIN_REPLY = "";
export const MAX_ANSWER_CHARS = 450;
export const MAX_ANSWER_SENTENCES = 3;
export const MAX_PROMPT_SOURCES = 6;
export const MAX_CITED_SOURCES = 3;

export function acuteSignals(_question: string): string[] {
  return [];
}

export function answerProblems(_text: string): string[] {
  return [];
}

export interface LogLike {
  warn(msg: string): void;
}

export class AdviceWriter {
  constructor(
    private readonly llm: Pick<HfLlm, "generateJson"> | null,
    private readonly log: LogLike = { warn: () => {} },
  ) {}

  async answer(_input: AdviceInput, _timeoutMs: number): Promise<AdviceAnswer> {
    return { kind: "none", reason: "llm_unavailable" };
  }
}
