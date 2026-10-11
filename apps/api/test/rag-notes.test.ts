// CONN-08 / AI-13: injury notes carry their sources per section, so an AI answer citing a
// section cites a page that actually says it. Format: docs/superpowers/specs/2026-10-10-advice-answer-design.md
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noteChunks, parseNote } from "../../../rag/ingest.js";
import { isReputableUrl } from "../src/services/advice.js";

const NOTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../rag/notes");

const SAMPLE = `---
body_part: knee
title: Training around a sore knee
reviewed: false
---

Notes for the team before the first heading are not content.

## Limit or avoid
Sources: https://www.nhs.uk/conditions/knee-pain/, https://www.orthoinfo.org/en/recovery/knee-conditioning-program/
High-impact work such as running and jumping.

## A circuit
Sources: team guidance
Push-ups, planks and seated presses.

## When to get checked
Sources: https://www.nhs.uk/conditions/knee-pain/
A knee that is very swollen or can't take weight.
`;

describe("injury note sections", () => {
  const note = parseNote("knee.md", SAMPLE);

  it("reads Windows (CRLF) line endings the same as LF", () => {
    expect(parseNote("knee.md", SAMPLE.replace(/\n/g, "\r\n"))).toEqual(note);
  });

  it("reads each section's sources and keeps the Sources line out of the text", () => {
    expect(note.sections.map((s) => [s.heading, s.sources, s.team_guidance, s.text])).toEqual([
      [
        "Limit or avoid",
        [
          "https://www.nhs.uk/conditions/knee-pain/",
          "https://www.orthoinfo.org/en/recovery/knee-conditioning-program/",
        ],
        false,
        "High-impact work such as running and jumping.",
      ],
      ["A circuit", [], true, "Push-ups, planks and seated presses."],
      [
        "When to get checked",
        ["https://www.nhs.uk/conditions/knee-pain/"],
        false,
        "A knee that is very swollen or can't take weight.",
      ],
    ]);
  });

  it("puts each section's own sources, and the team-guidance flag, on its chunk", () => {
    const chunks = noteChunks(note);
    expect(chunks.map((c) => c.id)).toEqual([
      "injury_note:knee#0",
      "injury_note:knee#1",
      "injury_note:knee#2",
    ]);
    expect(chunks[0]!.metadata).toMatchObject({
      sources: note.sections[0]!.sources,
      team_guidance: false,
      reviewed: false,
    });
    expect(chunks[1]!.metadata).toMatchObject({ sources: [], team_guidance: true });
    expect(chunks.every((c) => !c.content.includes("Sources:"))).toBe(true);
  });

  it("rejects a section without a Sources line", () => {
    const raw = SAMPLE.replace("Sources: team guidance\n", "");
    expect(() => parseNote("knee.md", raw)).toThrow(/A circuit/);
  });
});

describe("rag/notes", () => {
  const files = readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));

  it("has the five injury notes", () => {
    expect(files.sort()).toEqual(["ankle.md", "knee.md", "lower_back.md", "shoulder.md", "wrist.md"]);
  });

  for (const file of files) {
    describe(file, () => {
      // Parsed inside each test, so a malformed note fails its own tests instead of the whole file.
      const load = () => parseNote(file, readFileSync(path.join(NOTES_DIR, file), "utf8"));

      it("parses", () => {
        expect(load).not.toThrow();
      });

      it("cites only allowed sites, per section", () => {
        const note = load();
        for (const s of note.sections) {
          if (s.team_guidance) continue;
          expect(s.sources.length, s.heading).toBeGreaterThan(0);
          for (const url of s.sources) expect(isReputableUrl(url), `${s.heading}: ${url}`).toBe(true);
        }
      });

      it("ends with a sourced 'When to get checked' section", () => {
        const note = load();
        const last = note.sections.at(-1)!;
        expect(last.heading).toBe("When to get checked");
        expect(last.team_guidance).toBe(false);
      });

      it("has more sourced sections than team guidance", () => {
        const note = load();
        const guidance = note.sections.filter((s) => s.team_guidance).length;
        expect(note.sections.length - guidance).toBeGreaterThan(guidance);
      });
    });
  }
});
