// DB-02: apply drizzle/migrations to the branch in DATABASE_URL. Safe to re-run.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { createNeonDb } from "../src/db.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and point it at your Neon branch.");
  process.exit(1);
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "migrations",
);
const { db, close } = createNeonDb(url);
const host = new URL(url).host;

try {
  console.log(`Applying migrations to ${host} ...`);
  await migrate(db as unknown as NeonDatabase, { migrationsFolder });
  console.log("Migrations are up to date.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await close();
}
