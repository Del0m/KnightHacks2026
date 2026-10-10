// AI-12: query embeddings for the planner's retrieval (Architecture §10.1).
//
// Must match how rag/ingest.ts (CONN-08) embedded the chunks: the same model, and bge's retrieval
// instruction in front of queries (passages were embedded without it). test/planner.test.ts checks
// these constants against rag/ingest.ts. Kept here rather than imported, so the API doesn't need
// rag/'s own npm install at runtime.
import { InferenceClient } from "@huggingface/inference";

export const EMBED_MODEL = "BAAI/bge-small-en-v1.5";
export const EMBED_DIM = 384;
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/** Embeds one search query; resolves to a 384-number vector or throws. */
export type EmbedQuery = (query: string, timeoutMs: number) => Promise<number[]>;

export function hfQueryEmbedder(token: string, client = new InferenceClient(token)): EmbedQuery {
  return async (query, timeoutMs) => {
    const out = (await client.featureExtraction(
      { model: EMBED_MODEL, provider: "hf-inference", inputs: QUERY_PREFIX + query },
      { signal: AbortSignal.timeout(timeoutMs) },
    )) as number[] | number[][];
    const vector = Array.isArray(out[0]) ? (out as number[][])[0]! : (out as number[]);
    if (vector.length !== EMBED_DIM) throw new Error(`expected a ${EMBED_DIM}-d embedding, got ${vector.length}`);
    return vector;
  };
}
