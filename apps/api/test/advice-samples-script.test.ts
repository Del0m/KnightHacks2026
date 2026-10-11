import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  defaultOutPath,
  matchesExpect,
  parseArgs,
  renderReview,
  runSamples,
  summarize,
  type AdviceFixture,
} from "../scripts/advice-samples.js";
import type { AdviceAnswer, AdviceInput } from "../src/services/advice.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/advice-samples.json", import.meta.url), "utf8"),
) as AdviceFixture;

describe("advice samples script", () => {
  it("runs every sample with its sources and renders a review file", async () => {
    const seen: AdviceInput[] = [];
    const writer = {
      async answer(input: AdviceInput): Promise<AdviceAnswer> {
        seen.push(input);
        if (input.question.includes("two days")) {
          return {
            kind: "ai",
            text: "Soreness after a new session is common.",
            sources: [input.sources[0]!],
          };
        }
        return { kind: "none", reason: "llm_failed" };
      },
    };
    const results = await runSamples(writer, fixture, 8000);

    expect(seen).toHaveLength(fixture.samples.length);
    expect(seen[0]!.sources.map((s) => s.id)).toEqual(fixture.samples[0]!.source_ids);
    expect(results.find((r) => r.sample.id === "doms")!.matches).toBe(true);
    expect(results.find((r) => r.sample.expect === "fixed_pain")!.matches).toBe(false);

    const md = renderReview(results, { date: "2026-10-10", timeoutMs: 8000 });
    expect(md).toContain("A person must review every answer");
    expect(md).toContain("| doms | soreness | llm | ai | ");
    expect(md).toContain("Soreness after a new session is common.");
    expect(md).toContain(`- ${seen[0]!.sources[0]!.title}`);
    expect(md).toContain("none (llm_failed) (mismatch)");
    expect(md.match(/\*\*Reviewer notes\*\*/g)).toHaveLength(fixture.samples.length);

    // off_topic expects none, so it matches; every other llm sample got none (llm_failed) and doesn't.
    const offTopic = results.find((r) => r.sample.id === "off_topic")!;
    expect(offTopic.sample.expect).toBe("none");
    expect(offTopic.matches).toBe(true);
    expect(md).toContain("| off_topic | off_topic | none | none (llm_failed) | ");
    const total = fixture.samples.length;
    expect(md).toContain(`**Summary:** 2/${total} matched; none: ${total - 1} (llm_failed ${total - 1}).`);
  });

  it("matches each expectation to exactly one answer kind", () => {
    const ai: AdviceAnswer = { kind: "ai", text: "x", sources: [] };
    const pain: AdviceAnswer = { kind: "fixed_pain", text: "x", signals: ["sharp"] };
    const failed: AdviceAnswer = { kind: "none", reason: "llm_failed" };
    const declined: AdviceAnswer = { kind: "none", reason: "not_answerable" };

    expect(matchesExpect("llm", ai)).toBe(true);
    expect(matchesExpect("llm", failed)).toBe(false);
    expect(matchesExpect("llm", declined)).toBe(false);
    expect(matchesExpect("llm", pain)).toBe(false);
    expect(matchesExpect("fixed_pain", pain)).toBe(true);
    expect(matchesExpect("fixed_pain", ai)).toBe(false);
    expect(matchesExpect("fixed_pain", failed)).toBe(false);
    expect(matchesExpect("none", declined)).toBe(true);
    expect(matchesExpect("none", failed)).toBe(true);
    expect(matchesExpect("none", ai)).toBe(false);
    expect(matchesExpect("none", pain)).toBe(false);
  });

  it("summarizes matches and none results by reason", () => {
    const sample = fixture.samples[0]!;
    const r = (answer: AdviceAnswer, matches: boolean) => ({ sample, answer, latencyMs: 1, matches });
    expect(
      summarize([
        r({ kind: "ai", text: "x", sources: [] }, true),
        r({ kind: "none", reason: "llm_failed" }, false),
        r({ kind: "none", reason: "llm_failed" }, false),
        r({ kind: "none", reason: "not_answerable" }, true),
      ]),
    ).toBe("2/4 matched; none: 3 (llm_failed 2, not_answerable 1)");
    expect(summarize([r({ kind: "ai", text: "x", sources: [] }, true)])).toBe("1/1 matched; none: 0");
  });

  it("parses the command-line flags", () => {
    expect(parseArgs([])).toEqual({ timeoutMs: 8000 });
    expect(parseArgs(["--only", "doms, tore", "--timeout-ms", "12000", "--out", "/tmp/r.md"])).toEqual({
      only: ["doms", "tore"],
      timeoutMs: 12000,
      out: "/tmp/r.md",
    });
  });

  it.each([
    [["--only"], "--only needs a value"],
    [["--out"], "--out needs a value"],
    [["--timeout-ms"], "--timeout-ms needs a value"],
    [["--only", "--out", "x.md"], "--only needs a value"],
    [["--out", "--only", "doms"], "--out needs a value"],
    [["--timeout-ms", "--only", "doms"], "--timeout-ms needs a value"],
    [["--only", ","], "--only needs at least one sample id"],
    [["--timeout-ms", "0"], "--timeout-ms must be a positive number"],
    [["--timeout-ms", "soon"], "--timeout-ms must be a positive number"],
    [["--verbose"], "Unknown flag --verbose"],
    [["--only=doms"], "Unknown flag --only=doms"],
    [["doms"], 'Unexpected argument "doms"'],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it("defaults the review file to docs/reviews at the repo root", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    expect(defaultOutPath("2026-10-10")).toBe(path.join(repoRoot, "docs/reviews/advice-2026-10-10.md"));
  });
});
