// BE-01: environment is validated once on boot; the process exits with a readable list of problems.
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Comma-separated origins allowed to call the API from a browser (Expo web build).
  CORS_ORIGINS: optional,

  // DB-01: the pooled connection string for your own Neon branch (dev-<name>, demo or main).
  DATABASE_URL: z.string().url(),

  // BE-02: Neon Auth publishes its signing keys here; tokens are verified against them.
  NEON_AUTH_JWKS_URL: z.string().url(),
  NEON_AUTH_ISSUER: optional,
  NEON_AUTH_AUDIENCE: optional,

  // CONN-02: optional so the API runs without Databricks; sessions then stay export_status=pending.
  DATABRICKS_HOST: optional,
  DATABRICKS_CLIENT_ID: optional,
  DATABRICKS_CLIENT_SECRET: optional,
  // CONN-06: the gold-table sync also needs the SQL warehouse.
  DATABRICKS_WAREHOUSE_ID: optional,
  SPOTTER_PSEUDONYM_SECRET: optional,

  // CONN-07/09: Hugging Face Inference Providers. Without it, posts and comments skip moderation.
  HF_TOKEN: optional,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${problems}\nSee apps/api/.env.example.`);
  }
  return parsed.data;
}

export function databricksConfigured(env: Env): boolean {
  return Boolean(
    env.DATABRICKS_HOST &&
    env.DATABRICKS_CLIENT_ID &&
    env.DATABRICKS_CLIENT_SECRET &&
    env.SPOTTER_PSEUDONYM_SECRET,
  );
}

export function insightSyncConfigured(env: Env): boolean {
  return databricksConfigured(env) && Boolean(env.DATABRICKS_WAREHOUSE_ID);
}
