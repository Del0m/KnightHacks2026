// AI-11: write the rest notes for 20 sample sets (4 per MVP exercise) and save a review sheet
// for the team: each note as the lifter would see it, the fixed note it falls back to, and any
// LLM sentence the guard rejected.
//
//   npm run notes:samples                    # gpt-oss via HF_TOKEN, production 1 s note budget
//   npm run notes:samples -- --timeout 5000  # more time, to see what gpt-oss writes when it's slow
//
// Without HF_TOKEN every note is the fixed one. Writes docs/reviews/rest-notes-<date>.md.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HfLlm, llmConfigFromEnv } from "../src/integrations/huggingface/llm.js";
import { readSpecs, titleFromId } from "../src/services/exerciseSpecs.js";
import { fixedNote, RestNoteWriter, type NoteInput, type SpecRule } from "../src/services/restNote.js";
import { REST_BUDGET_MS } from "../src/services/restTime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const timeoutArg = process.argv.indexOf("--timeout");
const timeoutMs = timeoutArg > 0 ? Number(process.argv[timeoutArg + 1]) : REST_BUDGET_MS.note;

interface Sample {
  label: string;
  input: NoteInput;
}

// reps[i] gets the rule ids listed for i; every rep takes tempoMs.
function set(total: number, flagged: Record<number, string[]>, tempoMs = 2000) {
  return Array.from({ length: total }, (_, i) => ({
    tempo_ms: tempoMs,
    flags: (flagged[i] ?? []).map((rule_id) => ({ rule_id })),
  }));
}

function samples(exerciseName: string, rules: SpecRule[]): Sample[] {
  const byPriority = [...rules].sort((a, b) => a.priority - b.priority);
  const [first, second, third] = byPriority;
  const tempo = rules.find((r) => r.id === "tempo");
  const sample = (label: string, reps: NoteInput["reps"]): Sample => ({
    label,
    input: { exerciseName, rules, reps },
  });
  return [
    sample("8 reps, all clean", set(8, {})),
    sample(`8 reps, ${first!.id} on 2`, set(8, { 5: [first!.id], 7: [first!.id] })),
    sample(
      `10 reps, ${second!.id} on 3 and ${third!.id} on 4 (one note, ${second!.id} wins)`,
      set(10, {
        1: [second!.id],
        2: [third!.id],
        4: [second!.id, third!.id],
        6: [third!.id],
        8: [second!.id, third!.id],
      }),
    ),
    tempo
      ? sample(
          "6 reps, every rep lowered in about 0.8 s",
          set(6, Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, ["tempo"]])), 800),
        )
      : sample(
          `5 reps, ${first!.id} on all`,
          set(5, Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, [first!.id]]))),
        ),
  ];
}

function cell(text: string) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const specs = await readSpecs(path.join(ROOT, "specs/exercises"));
const all = specs.flatMap(({ spec, raw }) => {
  const rules = (raw as { rules: SpecRule[] }).rules;
  const name = spec.name ?? titleFromId(spec.id);
  return samples(name, rules).map((s) => ({ ...s, exercise: name }));
});

const llm = process.env.HF_TOKEN ? new HfLlm(llmConfigFromEnv()) : null;
if (!llm) console.warn("HF_TOKEN is not set: every note will be the fixed one");

const rows: string[] = [];
let llmCount = 0;
for (const [i, s] of all.entries()) {
  const rejected: string[] = [];
  const writer = new RestNoteWriter(llm, {
    warn: (msg) => rejected.push(msg.replace(/^\[rest-note\] /, "")),
  });
  const started = Date.now();
  const note = await writer.write(s.input, timeoutMs);
  const ms = Date.now() - started;
  if (note.source === "llm") llmCount++;
  const fixed = fixedNote(s.input).text;
  rows.push(
    `| ${i + 1} | ${s.exercise} | ${cell(s.label)} | ${cell(note.text)} | ${note.source} (${ms} ms) | ` +
      `${note.source === "llm" ? cell(fixed) : "same"} | ${cell(rejected.join("; ")) || ""} | | |`,
  );
  console.log(`${i + 1}/${all.length} ${s.exercise}: ${note.source} ${ms} ms`);
}

const date = new Date().toISOString().slice(0, 10);
const out = path.join(ROOT, "docs/reviews", `rest-notes-${date}.md`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(
  out,
  `# Rest-note review, ${date} (AI-11)

${all.length} sample sets, 4 per exercise, through the real \`RestNoteWriter\` (\`apps/api/src/services/restNote.ts\`)
with a ${timeoutMs} ms note budget. ${llmCount} of ${all.length} notes were written by gpt-oss; the rest are the
spec's fixed \`rest_note\` (all-clean sets never call the LLM). Regenerate with \`npm run notes:samples\` in \`apps/api\`.

**What to check** (Architecture §7): good news first; at most one suggestion; about the movement, not the person;
no commands; kind, and specific enough to act on. Put ✓ or ✗ in *OK?* and say why in *Comment*.

| # | Exercise | Set | Note shown | Source | Fixed fallback | Guard rejected | OK? | Comment |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`,
);
console.log(`Wrote ${path.relative(ROOT, out)}`);
