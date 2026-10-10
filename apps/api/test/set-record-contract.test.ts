import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExportSession, SetRecord } from "../../../specs/set-record/types.js";
import { schema } from "../src/db.js";
import {
  buildJointsFile,
  buildMetadata,
  pseudonymize,
  type UploadConfig,
} from "../src/integrations/databricks/upload.js";
import { createSessionInput, setInput } from "../src/routes/sessions.js";
import { buildExportSession } from "../src/services/sessions.js";
import { setup } from "./helpers.js";

const specsRoot = path.resolve(import.meta.dirname, "../../../specs");
const contract = JSON.parse(readFileSync(path.join(specsRoot, "set-record/schema.json"), "utf8"));
const { validateSchema } = (await import(pathToFileURL(path.join(specsRoot, "validate.mjs")).href)) as {
  validateSchema: (value: unknown, definition: unknown, root: unknown) => string[];
};
const validate = (value: unknown, definition: string) =>
  validateSchema(value, contract.$defs[definition], contract);
const fixtures = <Value>(definition: string): [string, Value][] =>
  globSync(`set-record/fixtures/valid/${definition}/**/*.json`, { cwd: specsRoot })
    .sort()
    .map((file) => [path.basename(file), JSON.parse(readFileSync(path.join(specsRoot, file), "utf8"))]);
const records = fixtures<SetRecord>("SetRecord");
const sample = records.find(([name]) => name === "minimal.json")![1];
const config = { pseudonymSecret: "set-record-contract-secret" } as UploadConfig;

type FieldPath = (string | number)[];
function replace(value: unknown, fieldPath: FieldPath, replacement: unknown, remove = false) {
  let parent = value as Record<string | number, unknown>;
  for (const part of fieldPath.slice(0, -1)) parent = parent[part] as typeof parent;
  if (remove) delete parent[fieldPath.at(-1)!];
  else parent[fieldPath.at(-1)!] = replacement;
}

interface Shape {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Shape>;
  items?: Shape;
}
function requiredPaths(value: unknown, shape: Shape, prefix: FieldPath = []): FieldPath[] {
  if (shape.$ref) return requiredPaths(value, contract.$defs[shape.$ref.split("/").at(-1)!], prefix);
  if (Array.isArray(value))
    return value.length && shape.items ? requiredPaths(value[0], shape.items, [...prefix, 0]) : [];
  if (value === null || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(shape.required ?? []).map((key) => [...prefix, key]),
    ...Object.entries(shape.properties ?? {}).flatMap(([key, child]) =>
      requiredPaths(object[key], child, [...prefix, key]),
    ),
  ];
}

describe("shared request contracts", () => {
  it("discovers the phone fixtures", () => expect(records.length).toBeGreaterThan(1));

  it.each(records)("accepts SetRecord %s unchanged", (_name, record) => {
    expect(validate(record, "SetRecord")).toEqual([]);
    expect(setInput.parse(record)).toEqual(record);
  });

  it.each(fixtures("SessionStart"))("accepts SessionStart %s", (_name, session) => {
    expect(validate(session, "SessionStart")).toEqual([]);
    expect(createSessionInput.parse(session)).toEqual(session);
  });

  const nested = structuredClone(sample);
  nested.reps[0]!.flags = [{ rule_id: "depth", severity: "form", rep_index: 0 }];
  it.each(
    requiredPaths(nested, contract.$defs.SetRecord).map(
      (fieldPath) => [fieldPath.join("."), fieldPath] as const,
    ),
  )("rejects missing required field %s", (_name, fieldPath) => {
    const input = structuredClone(nested);
    replace(input, fieldPath, undefined, true);
    expect(validate(input, "SetRecord").length).toBeGreaterThan(0);
    expect(setInput.safeParse(input).success).toBe(false);
  });

  it.each([undefined, null, "on_device", "telepathy", ""])(
    "rejects absent or invalid inference mode %s",
    (inference_mode) => {
      const input = inference_mode === undefined ? {} : { inference_mode };
      expect(validate(input, "SessionStart").length).toBeGreaterThan(0);
      expect(createSessionInput.safeParse(input).success).toBe(false);
    },
  );

  it.each(["coreml", "vision", "cloud"])("requires and preserves inference mode %s", (inference_mode) => {
    expect(createSessionInput.parse({ inference_mode, clean: true })).toEqual({ inference_mode });
  });

  it("retains the API's datetime constraint, which is tighter than SessionStart's string schema", () => {
    const input = { inference_mode: "vision", started_at: "not a date" };
    expect(validate(input, "SessionStart")).toEqual([]);
    expect(createSessionInput.safeParse(input).success).toBe(false);
    expect(createSessionInput.safeParse({ ...input, started_at: "2026-10-10T12:00:00-04:00" }).success).toBe(
      true,
    );
  });

  const bounds: [FieldPath, unknown[]][] = [
    [["schema_version"], [0, 1, 2, null]],
    [["set_index"], [-1, 0, 200, 201, 0.5, null, Infinity]],
    [["exercise_id"], ["a", "ab", "a".repeat(60), "a".repeat(61), "Squat!", null]],
    [["weight_kg"], [-1, 0, 1000, 1001, null, Infinity]],
    [["end_reason"], ["still", "absent", "lost", "manual", "done", null]],
    [["partial_reps"], [-1, 0, 1.5, null]],
    [["fps"], [0, 0.1, 240, 241, null, Infinity]],
    [
      ["frames", 0, "t_ms"],
      [-1, 0, 1.5, null],
    ],
    [
      ["frames", 0, "kp", 0],
      [-2, 0, 2, null, NaN, Infinity],
    ],
    [
      ["reps", 0, "tempo_ms"],
      [-1, 0, 120000, 120001, 1.5, null],
    ],
    [
      ["reps", 0, "range_deg"],
      [-1, 0, 180, 181, 0.5, null, Infinity],
    ],
    [
      ["reps", 0, "quality"],
      [-0.1, 0, 1, 1.1, null, Infinity],
    ],
    ...["start_ms", "end_ms", "lowering_ms", "rising_ms"].map((key): [FieldPath, unknown[]] => [
      ["reps", 0, key],
      [-1, 0, 1.5, null],
    ]),
    [
      ["reps", 0, "flags", 0, "rule_id"],
      ["", "a", "a".repeat(60), "a".repeat(61), "bad-id", null],
    ],
    [
      ["reps", 0, "flags", 0, "severity"],
      ["form", "safety", "info", "warn", null],
    ],
  ];
  it.each(
    bounds.flatMap(([fieldPath, values]) =>
      values.map((value) => [fieldPath.join("."), value, fieldPath] as const),
    ),
  )("matches schema boundaries for %s = %s", (_name, value, fieldPath) => {
    const input = structuredClone(nested);
    Object.assign(input.reps[0]!, { start_ms: null, end_ms: null, lowering_ms: null, rising_ms: null });
    replace(input, fieldPath, value);
    expect(setInput.safeParse(input).success).toBe(validate(input, "SetRecord").length === 0);
  });

  it.each([50, 51, 52])("matches keypoint length %s", (length) => {
    const input = structuredClone(sample);
    input.frames[0]!.kp = Array(length).fill(0);
    expect(setInput.safeParse(input).success).toBe(validate(input, "SetRecord").length === 0);
  });

  it.each([
    ["frames", 5400],
    ["reps", 200],
    ["flags", 20],
  ] as const)("matches the %s array limit", (field, maximum) => {
    for (const length of [0, maximum, maximum + 1]) {
      const input = structuredClone(nested);
      if (field === "frames") input.frames = Array.from({ length }, () => structuredClone(nested.frames[0]!));
      if (field === "reps")
        input.reps = Array.from({ length }, (_, rep_index) => ({ ...nested.reps[0]!, rep_index, flags: [] }));
      if (field === "flags")
        input.reps[0]!.flags = Array.from({ length }, () => ({
          rule_id: "depth",
          severity: "form",
          rep_index: 0,
        }));
      expect(setInput.safeParse(input).success).toBe(validate(input, "SetRecord").length === 0);
    }
  });

  it.each([
    ["rep position", ["reps", 0, "rep_index"], 5],
    ["flag position", ["reps", 0, "flags", 0, "rep_index"], 5],
    ["rep duration", ["reps", 0, "end_ms"], 20],
    ["phase sum", ["reps", 0, "rising_ms"], 1],
    ["phase duration", ["reps", 0, "lowering_ms"], 1801],
  ] as [string, FieldPath, number][])("rejects inconsistent %s", (_name, fieldPath, value) => {
    const input = structuredClone(nested);
    replace(input, fieldPath, value);
    expect(setInput.safeParse(input).success).toBe(false);
  });

  it("strips old server-derived fields and extra keys at every depth", () => {
    const input = structuredClone(nested);
    Object.assign(input, { clean_share: 1, medal: "gold", score_source: "databricks", video: "private" });
    Object.assign(input.reps[0]!, { clean: true, email: "private" });
    Object.assign(input.reps[0]!.flags[0]!, { note: "private" });
    Object.assign(input.frames[0]!, { image: "private" });
    expect(setInput.parse(input)).toEqual(nested);
  });
});

describe("route -> database -> export -> gzip", () => {
  let testApp: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    testApp = await setup();
  });
  afterAll(() => testApp.close());

  it("preserves sparse positions, nullable quality, timing and privacy", async () => {
    const api = await testApp.as("private-contract-user");
    await api.post("/me/injuries", { body_part: "knee", notes: "secret injury notes" });
    const started = await api.post("/sessions", { inference_mode: "vision", device: "iPhone" });
    expect(started.status).toBe(201);
    const sessionId = started.body.id as string;
    for (const set_index of [2, 9]) {
      const record = structuredClone(sample);
      record.set_index = set_index;
      const posted = await api.post(`/sessions/${sessionId}/sets`, record);
      expect(posted.status).toBe(201);
      const [stored] = await testApp.db.select().from(schema.sets).where(eq(schema.sets.id, posted.body.id));
      expect(stored).toMatchObject({
        position: set_index,
        endReason: record.end_reason,
        partialReps: record.partial_reps,
      });
      const storedReps = await testApp.db
        .select()
        .from(schema.reps)
        .where(eq(schema.reps.setId, stored!.id))
        .orderBy(schema.reps.position);
      expect(
        storedReps.map((rep) => ({
          lowering_ms: rep.loweringMs,
          rising_ms: rep.risingMs,
          quality: rep.quality,
        })),
      ).toEqual(
        record.reps.map((rep) => ({
          lowering_ms: rep.lowering_ms,
          rising_ms: rep.rising_ms,
          quality: rep.quality,
        })),
      );
    }
    expect((await api.post(`/sessions/${sessionId}/finish`)).status).toBe(200);
    const exported = testApp.queue.sessions.find((session) => session.id === sessionId)!;
    expect(validate(exported, "ExportSession")).toEqual([]);
    expect(exported.sets.map((set) => set.set_index)).toEqual([2, 9]);
    for (const set of exported.sets) {
      expect(set.reps.map((rep) => rep.quality)).toEqual(sample.reps.map((rep) => rep.quality));
      expect(set.reps.map((rep) => rep.flags)).toEqual(sample.reps.map((rep) => rep.flags));
      set.reps.forEach((rep, index) => expect(rep.range_deg).toBeCloseTo(sample.reps[index]!.range_deg, 4));
    }
    Object.assign(exported, { email: "private@email", notes: "secret injury notes" });
    Object.assign(exported.sets[0]!, { video: "secret video" });
    Object.assign(exported.sets[0]!.reps[0]!, { image: "secret image" });
    Object.assign(exported.sets[0]!.reps[1]!.flags[0]!, { notes: "secret flag notes" });
    Object.assign(exported.sets[0]!.frames[0]!, { image: "secret frame" });
    const metadata = buildMetadata(exported, config, "joints/test.ndjson.gz");
    const lines = gunzipSync(buildJointsFile(exported))
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(validate(metadata, "ExportMeta")).toEqual([]);
    expect(metadata.user_id).toBe(pseudonymize("private-contract-user", config.pseudonymSecret));
    expect(metadata.sets.map((set) => set.set_index)).toEqual([2, 9]);
    expect(lines.map((line) => line.set_index)).toEqual([2, 9]);
    for (const line of lines) {
      expect(validate(line, "ExportJointsLine")).toEqual([]);
      expect(line.frames).toEqual(sample.frames);
    }
    const serialized = JSON.stringify({ metadata, lines });
    for (const forbidden of ["private-contract-user", "private@email", "secret", "image", "video"])
      expect(serialized).not.toContain(forbidden);
    const rebuilt = await buildExportSession(testApp.db, "private-contract-user", sessionId);
    expect(validate(rebuilt, "ExportSession")).toEqual([]);
    expect(
      rebuilt.sets.map((set) => ({ set_index: set.set_index, fps: set.fps, frames: set.frames })),
    ).toEqual([
      { set_index: 2, fps: null, frames: [] },
      { set_index: 9, fps: null, frames: [] },
    ]);
  });

  it("preserves actual stored rep positions and normalizes only known legacy severities", async () => {
    const api = await testApp.as("legacy-contract-user");
    const started = await api.post("/sessions", { inference_mode: "coreml" });
    const [set] = await testApp.db
      .insert(schema.sets)
      .values({ sessionId: started.body.id, position: 7, exerciseId: "squat", reps: 1 })
      .returning();
    const [rep] = await testApp.db
      .insert(schema.reps)
      .values({ setId: set!.id, position: 4, tempoMs: 1000, rangeDeg: 90, quality: 0.25, clean: false })
      .returning();
    await testApp.db.insert(schema.formFlags).values([
      { repId: rep!.id, ruleId: "legacy_info", severity: "info" },
      { repId: rep!.id, ruleId: "legacy_warn", severity: "warn" },
      { repId: rep!.id, ruleId: "safety_rule", severity: "safety" },
    ]);
    const exported: ExportSession = await buildExportSession(
      testApp.db,
      "legacy-contract-user",
      started.body.id,
    );
    expect(validate(exported, "ExportSession")).toEqual([]);
    const metadata = buildMetadata(exported, config, "joints/legacy.ndjson.gz");
    expect(validate(metadata, "ExportMeta")).toEqual([]);
    expect(metadata.sets[0]).toMatchObject({ set_index: 7, end_reason: null, partial_reps: null });
    expect(metadata.sets[0]!.reps[0]).toMatchObject({
      rep_index: 4,
      quality: 0.25,
      start_ms: null,
      end_ms: null,
      lowering_ms: null,
      rising_ms: null,
    });
    expect(metadata.sets[0]!.reps[0]!.flags).toEqual([
      { rule_id: "legacy_info", severity: "form", rep_index: 4 },
      { rule_id: "legacy_warn", severity: "form", rep_index: 4 },
      { rule_id: "safety_rule", severity: "safety", rep_index: 4 },
    ]);
    await testApp.db
      .update(schema.formFlags)
      .set({ severity: "unknown" })
      .where(eq(schema.formFlags.repId, rep!.id));
    await expect(buildExportSession(testApp.db, "legacy-contract-user", started.body.id)).rejects.toThrow(
      "Unsupported stored flag severity",
    );
  });
});
