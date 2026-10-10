import path from "node:path";
import { defineConfig } from "vitest/config";

const dep = (name: string) => path.resolve(import.meta.dirname, "node_modules", name);

export default defineConfig({
  resolve: {
    // test/conn-compat.test.ts imports rag/ingest.ts, which lives outside this package;
    // resolve its dependencies from here so rag/ doesn't need its own install for tests.
    alias: {
      "@huggingface/inference": dep("@huggingface/inference"),
      "@neondatabase/serverless": dep("@neondatabase/serverless"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    // Each test file boots its own in-memory Postgres (PGlite) and runs the real migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
