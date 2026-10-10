// BE-06: load specs/exercises/*.json (AI-05) into the exercises table. Re-runnable: upserts by id.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";

// Only the fields the library needs are checked; the rest of the spec is stored as written.
const specHeader = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{2,60}$/),
    name: z.string().min(1).max(80).optional(),
    muscles: z.array(z.string()).optional(),
    level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  })
  .passthrough();

export function titleFromId(id: string): string {
  return id
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export async function readSpecs(dir: string) {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "schema.json").sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return Promise.all(
    files.map(async (file) => {
      const raw: unknown = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      const spec = specHeader.parse(raw);
      if (`${spec.id}.json` !== file) throw new Error(`${file}: id "${spec.id}" must match the file name`);
      return { spec, raw };
    }),
  );
}

export async function loadSpecs(db: Db, dir: string): Promise<string[]> {
  const specs = await readSpecs(dir);
  if (!specs.length) return [];
  await db
    .insert(schema.exercises)
    .values(
      specs.map(({ spec, raw }) => ({
        id: spec.id,
        name: spec.name ?? titleFromId(spec.id),
        muscles: spec.muscles ?? [],
        level: spec.level ?? "beginner",
        formSpec: raw,
      })),
    )
    .onConflictDoUpdate({
      target: schema.exercises.id,
      set: {
        name: sql`excluded.name`,
        muscles: sql`excluded.muscles`,
        level: sql`excluded.level`,
        formSpec: sql`excluded.form_spec`,
        updatedAt: sql`now()`,
      },
    });
  return specs.map((s) => s.spec.id);
}
