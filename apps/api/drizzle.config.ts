import { defineConfig } from "drizzle-kit";

// db:generate only diffs the schema files, so it needs no connection.
// db:migrate runs scripts/migrate.ts, which reads DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema/index.ts",
  out: "./drizzle/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  casing: "snake_case",
});
