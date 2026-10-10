// BE-06: npm run db:load-specs, upserts specs/exercises/*.json into the exercises table.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNeonDb } from "../src/db.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const specsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/exercises");
const { db, close } = createNeonDb(url);
try {
  const ids = await loadSpecs(db, specsDir);
  console.log(ids.length ? `Loaded ${ids.length} specs: ${ids.join(", ")}` : `No specs found in ${specsDir}`);
} finally {
  await close();
}
