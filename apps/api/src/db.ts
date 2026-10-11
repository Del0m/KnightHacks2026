// DB-02: Drizzle over the Neon serverless driver. The WebSocket Pool (not neon-http) is used
// because session finish writes the medal, PRs and feed posts in one transaction.
import { Pool, neonConfig } from "@neondatabase/serverless";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import ws from "ws";
import * as schema from "../drizzle/schema/index.js";

export { schema };
export type Schema = typeof schema;

// Any Drizzle Postgres database or transaction with our schema: Neon in the app, PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

// Columns are camelCase in TypeScript and snake_case in Postgres. Every drizzle() call must pass this.
export const CASING = "snake_case" as const;

// `query` runs raw SQL on the same pool, for jobs that don't use Drizzle (the insight sync), so
// the API has one Neon client.
export function createNeonDb(connectionString: string): {
  db: Db;
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  close: () => Promise<void>;
} {
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool, schema, casing: CASING });
  return {
    db: db as unknown as Db,
    query: (text, params) => pool.query(text, params as unknown[]),
    close: () => pool.end(),
  };
}
