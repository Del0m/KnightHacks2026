// AI-13: answer the 20 sample advice questions on the real gpt-oss chain and write a Markdown
// review file. Someone on the team reviews every answer before the samples count as reviewed.
//
//   npm run advice:samples                                  # all samples, 8 s per answer
//   npm run advice:samples -- --only doms,tore --timeout-ms 12000 --out /tmp/review.md
//
// Writes docs/reviews/advice-<YYYY-MM-DD>.md at the repo root unless --out is given.
// Needs HF_TOKEN. Samples run one at a time to spare credits and rate limits.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HfLlm, llmConfigFromEnv } from "../src/integrations/huggingface/llm.js";
import { AdviceWriter, type AdviceAnswer, type AdviceSource } from "../src/services/advice.js";

export interface AdviceSample {
  id: string;
  category: string;
  expect: "llm" | "fixed_pain" | "none";
  question: string;
  source_ids: string[];
}

export interface AdviceFixture {
  sources: AdviceSource[];
  samples: AdviceSample[];
}

export interface SampleResult {
  sample: AdviceSample;
  answer: AdviceAnswer;
  latencyMs: number;
  matches: boolean;
}

// fixed_pain needs the fixed reply, llm needs a real AI answer (a failed or declined call is a
// mismatch, so the summary isn't inflated), none needs the model to decline.
export function matchesExpect(expect: AdviceSample["expect"], answer: AdviceAnswer) {
  const want = { fixed_pain: "fixed_pain", llm: "ai", none: "none" } as const;
  return answer.kind === want[expect];
}

export interface CliOptions {
  only?: string[];
  out?: string;
  timeoutMs: number;
}

const VALUE_FLAGS = ["--only", "--out", "--timeout-ms"] as const;

// Pure so it can be tested. Throws with a message the CLI prints before exiting 1.
export function parseArgs(argv: string[]): CliOptions {
  const values: Partial<Record<(typeof VALUE_FLAGS)[number], string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!(VALUE_FLAGS as readonly string[]).includes(flag)) {
      throw new Error(
        flag.startsWith("-")
          ? `Unknown flag ${flag}. Use ${VALUE_FLAGS.join(", ")}.`
          : `Unexpected argument "${flag}". Use ${VALUE_FLAGS.join(", ")}.`,
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    values[flag as (typeof VALUE_FLAGS)[number]] = value;
    i++;
  }
  const timeoutMs = Number(values["--timeout-ms"] ?? 8000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `--timeout-ms must be a positive number of milliseconds, got "${values["--timeout-ms"]}"`,
    );
  }
  const options: CliOptions = { timeoutMs };
  if (values["--only"] !== undefined) {
    const only = values["--only"]
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!only.length) throw new Error("--only needs at least one sample id");
    options.only = only;
  }
  if (values["--out"] !== undefined) options.out = values["--out"];
  return options;
}

export function defaultOutPath(date: string) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(repoRoot, "docs/reviews", `advice-${date}.md`);
}

export function summarize(results: SampleResult[]) {
  const matched = results.filter((r) => r.matches).length;
  const reasons = new Map<string, number>();
  for (const { answer } of results) {
    if (answer.kind === "none") reasons.set(answer.reason, (reasons.get(answer.reason) ?? 0) + 1);
  }
  const none = [...reasons.values()].reduce((a, b) => a + b, 0);
  const byReason = [...reasons].map(([reason, n]) => `${reason} ${n}`).join(", ");
  return `${matched}/${results.length} matched; none: ${none}${none ? ` (${byReason})` : ""}`;
}

export async function runSamples(
  writer: Pick<AdviceWriter, "answer">,
  fixture: AdviceFixture,
  timeoutMs: number,
  onResult: (r: SampleResult, i: number, total: number) => void = () => {},
): Promise<SampleResult[]> {
  const byId = new Map(fixture.sources.map((s) => [s.id, s]));
  const results: SampleResult[] = [];
  for (const sample of fixture.samples) {
    const sources = sample.source_ids.map((id) => {
      const source = byId.get(id);
      if (!source) throw new Error(`Sample ${sample.id} cites unknown source ${id}`);
      return source;
    });
    const started = Date.now();
    const answer = await writer.answer({ question: sample.question, sources }, timeoutMs);
    const result = {
      sample,
      answer,
      latencyMs: Date.now() - started,
      matches: matchesExpect(sample.expect, answer),
    };
    results.push(result);
    onResult(result, results.length, fixture.samples.length);
  }
  return results;
}

function got(answer: AdviceAnswer) {
  return answer.kind === "none" ? `none (${answer.reason})` : answer.kind;
}

function cell(text: string) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function sourceLine(s: AdviceSource) {
  const where = s.url ? s.url : s.post_id ? `post ${s.post_id}` : s.id;
  return `- ${s.title} (${where})`;
}

export function renderReview(results: SampleResult[], meta: { date: string; timeoutMs: number }) {
  const rows = results.map(
    ({ sample, answer, latencyMs, matches }) =>
      `| ${sample.id} | ${sample.category} | ${sample.expect} | ${cell(got(answer))}${matches ? "" : " (mismatch)"} | ${latencyMs} ms |`,
  );
  const details = results.map(({ sample, answer }) => {
    const text = answer.kind === "none" ? `_No answer: ${answer.reason}._` : answer.text;
    const extra =
      answer.kind === "ai"
        ? `**Cited sources**\n\n${answer.sources.length ? answer.sources.map(sourceLine).join("\n") : "- none"}`
        : answer.kind === "fixed_pain"
          ? `**Signals:** ${answer.signals.join(", ") || "none"}`
          : "";
    return [
      `### ${sample.id} (${sample.category}, expected ${sample.expect}, got ${got(answer)})`,
      `**Question:** ${sample.question}`,
      `**Answer:** ${text}`,
      extra,
      "**Reviewer notes** (acceptable? why):",
    ]
      .filter(Boolean)
      .join("\n\n");
  });
  return `# Advice answer review, ${meta.date} (AI-13)

${results.length} sample questions from \`apps/api/test/fixtures/advice-samples.json\`, answered by the real
\`AdviceWriter\` (\`apps/api/src/services/advice.ts\`) on the gpt-oss chain with a ${meta.timeoutMs} ms timeout.
Expected outcomes: \`fixed_pain\` is the fixed pain reply, \`llm\` is an AI answer (a \`none\` result, e.g.
\`none (llm_failed)\`, counts as a mismatch), \`none\` is the model declining.

**Summary:** ${summarize(results)}.
Regenerate with \`npm run advice:samples\` in \`apps/api\`.

**A person must review every answer below before AI-13's samples count as reviewed.** Check that each answer
uses only its sources, doesn't diagnose, prescribe medication or promise results, and reads kindly. Fill in
*Reviewer notes* for each sample with acceptable or not, and why.

| Id | Category | Expected | Got | Latency |
|---|---|---|---|---|
${rows.join("\n")}

## Answers

${details.join("\n\n")}
`;
}

function localDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`advice:samples: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!process.env.HF_TOKEN) {
    console.error("HF_TOKEN is not set: advice:samples needs it to call gpt-oss. Add it to apps/api/.env.");
    process.exit(1);
  }
  const { timeoutMs, only } = options;
  const date = localDate();
  const out = options.out ? path.resolve(options.out) : defaultOutPath(date);

  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../test/fixtures/advice-samples.json",
  );
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as AdviceFixture;
  if (only) {
    const unknown = only.filter((id) => !fixture.samples.some((s) => s.id === id));
    if (unknown.length) {
      console.error(`Unknown sample id(s): ${unknown.join(", ")}`);
      process.exit(1);
    }
    fixture.samples = fixture.samples.filter((s) => only.includes(s.id));
  }

  const writer = new AdviceWriter(new HfLlm(llmConfigFromEnv()), { warn: (msg) => console.warn(msg) });
  const results = await runSamples(writer, fixture, timeoutMs, (r, i, total) =>
    console.log(
      `${i}/${total} ${r.sample.id}: ${got(r.answer)} ${r.latencyMs} ms${r.matches ? "" : " (mismatch)"}`,
    ),
  );
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderReview(results, { date, timeoutMs }));
  console.log(`${summarize(results)}. Wrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
