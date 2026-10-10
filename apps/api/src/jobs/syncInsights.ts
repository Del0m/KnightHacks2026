// CONN-06: every 15 minutes, copy gold tables from Databricks into Neon (Architecture §11.3).
// The app only ever reads Neon, so it never waits on a cold warehouse or a spent quota.
//
//   spotter.gold.gold_user_progress_daily -> progress_daily   key (user_id, date, exercise_id)
//   spotter.gold.gold_injury_risk_scores  -> risk_insights    key (user_id, body_part, as_of)
//   spotter.gold.gold_rom_trend           -> rom_trend        key (user_id, angle, side, week)
//
// Databricks only knows pseudonymous ids (CONN-02), so we map them back by computing the
// pseudonym of every Neon user. Rows for unknown pseudonyms (deleted accounts, synthetic demo
// users) are skipped. Only the last LOOKBACK_DAYS are re-read each run; upserts make re-runs
// and overlapping windows harmless.
//
// Tables: progress_daily and risk_insights in drizzle/schema/progress.ts (DB-07, migration 0001).
// Started from src/index.ts when insightSyncConfigured(env); run it on one API instance only.

import { DBSQLClient } from "@databricks/sql";
import { pseudonymize } from "../integrations/databricks/upload";

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 500;
const ROM_LOOKBACK_DAYS = 120;

// ---- Config ----

export interface SyncConfig {
  host: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  warehouseId: string;
  pseudonymSecret: string;
  lookbackDays: number;
}

export function syncConfigFromEnv(env = process.env): SyncConfig {
  const required = [
    "DATABRICKS_HOST",
    "DATABRICKS_CLIENT_ID",
    "DATABRICKS_CLIENT_SECRET",
    "DATABRICKS_WAREHOUSE_ID",
    "SPOTTER_PSEUDONYM_SECRET",
  ] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing env for insight sync: ${missing.join(", ")}`);

  return {
    host: env.DATABRICKS_HOST!.replace(/\/+$/, ""),
    clientId: env.DATABRICKS_CLIENT_ID!,
    clientSecret: env.DATABRICKS_CLIENT_SECRET!,
    scopes: env.DATABRICKS_OAUTH_SCOPES || "all-apis",
    warehouseId: env.DATABRICKS_WAREHOUSE_ID!,
    pseudonymSecret: env.SPOTTER_PSEUDONYM_SECRET!,
    lookbackDays: Number(env.SYNC_LOOKBACK_DAYS) || 35,
  };
}

// ---- Neon ----

// Matches neon(url).query(text, params) from @neondatabase/serverless (returns rows), and
// PGlite / node-postgres style clients (return { rows }).
export interface Db {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

async function rowsOf<T>(db: Db, text: string, params?: unknown[]): Promise<T[]> {
  const res = await db.query(text, params);
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

// ---- Gold rows ----

export interface ProgressRow {
  user_id: string; // pseudonym
  date: string; // YYYY-MM-DD
  exercise_id: string;
  sets: number | null;
  reps: number | null;
  clean_reps: number | null;
  clean_share: number | null;
  volume_kg: number | null;
  avg_range_deg: number | null;
  avg_quality: number | null;
  est_1rm_kg: number | null;
  is_pr: boolean | null;
}

export interface RiskRow {
  user_id: string; // pseudonym
  body_part: string;
  date: string;
  score: number;
  top_features: string[];
}

// CONN-14: weekly range of motion per angle and side (gold_rom_trend -> rom_trend, DB-12).
export interface RomRow {
  user_id: string; // pseudonym
  angle: string; // spec angle name: knee, elbow, hip
  side: string; // left | right
  week: string; // Monday, YYYY-MM-DD
  peak_range_deg: number;
  baseline_range_deg: number | null;
  healthy_side_range_deg: number | null;
  change_deg: number | null;
}

export interface GoldSnapshot {
  progress: ProgressRow[];
  risk: RiskRow[];
  rom?: RomRow[];
}

// Plain-language reasons for the app (Architecture §11.2). A trend, never a diagnosis.
const FEATURE_TEXT: Record<string, string> = {
  flag_rate_rising: "form flags are showing up more often than usual",
  range_shrinking: "your range of motion has been getting smaller",
  asymmetry: "your left and right sides are moving unevenly",
  acute_chronic_load: "this week's training load jumped compared with your recent weeks",
  tempo_speeding_up: "your reps have been getting faster on the way down",
};

export function explainRisk(bodyPart: string, features: string[]): string {
  const part = bodyPart.replace(/_/g, " ");
  const reasons = features.map((f) => FEATURE_TEXT[f]).filter(Boolean);
  if (reasons.length === 0) return `No warning signs for your ${part} right now.`;
  const list = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`;
  return `Worth keeping an eye on your ${part}: ${list}. This is a training trend, not a diagnosis.`;
}

// ---- Databricks ----

async function getToken(cfg: SyncConfig): Promise<string> {
  // Our own OAuth M2M call so we can request the service principal's scopes; the driver's
  // built-in OAuth asks for "all-apis", which spotter-api doesn't have.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${cfg.host}/oidc/v1/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: cfg.scopes }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function readGold(cfg: SyncConfig, log: LogLike = console): Promise<GoldSnapshot> {
  const days = Math.max(1, Math.floor(cfg.lookbackDays));
  const client = new DBSQLClient();
  // The driver re-emits connection failures as 'error' events; unhandled, they crash the API.
  client.on("error", (err) => log.error(`[insights] databricks client: ${err.message}`));
  await client.connect({
    host: cfg.host.replace(/^https?:\/\//, ""),
    path: `/sql/1.0/warehouses/${cfg.warehouseId}`,
    token: await getToken(cfg),
  });
  const session = await client.openSession();
  const run = async <T>(statement: string): Promise<T[]> => {
    const op = await session.executeStatement(statement, { runAsync: true });
    try {
      return (await op.fetchAll()) as T[];
    } finally {
      await op.close();
    }
  };

  try {
    const progress = await run<ProgressRow>(`
      SELECT user_id, CAST(session_date AS STRING) AS date, exercise_id,
             sets, reps, clean_reps, clean_share, volume_kg,
             avg_range_deg, avg_quality, est_1rm_kg, is_pr
      FROM spotter.gold.gold_user_progress_daily
      WHERE session_date >= date_sub(current_date(), ${days})`);
    const risk = await run<RiskRow>(`
      SELECT user_id, body_part, CAST(date AS STRING) AS date, score, top_features
      FROM spotter.gold.gold_injury_risk_scores
      WHERE date >= date_sub(current_date(), ${days}) AND score IS NOT NULL`);
    // Range of motion is charted from the start of a rehab plan, so it looks further back.
    const rom = await run<RomRow>(`
      SELECT user_id, angle, side, CAST(week AS STRING) AS week, peak_range_deg,
             baseline_range_deg, healthy_side_range_deg, change_deg
      FROM spotter.gold.gold_rom_trend
      WHERE week >= date_sub(current_date(), ${Math.max(days, ROM_LOOKBACK_DAYS)})`);
    return { progress, risk, rom };
  } finally {
    await session.close();
    await client.close();
  }
}

// ---- Upserts ----

const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) await write(rows.slice(i, i + BATCH_SIZE));
}

export async function upsertProgress(db: Db, rows: (ProgressRow & { neon_user_id: string })[]) {
  await inBatches(rows, (b) =>
    db.query(
      `INSERT INTO progress_daily (user_id, date, exercise_id, sets, reps, clean_reps, clean_share,
                                   volume_kg, avg_range_deg, avg_quality, est_1rm_kg, is_pr, synced_at)
       SELECT *, now() FROM unnest($1::text[], $2::date[], $3::text[], $4::int[], $5::int[], $6::int[],
                                   $7::real[], $8::real[], $9::real[], $10::real[], $11::real[], $12::boolean[])
       ON CONFLICT (user_id, date, exercise_id) DO UPDATE SET
         sets = EXCLUDED.sets, reps = EXCLUDED.reps, clean_reps = EXCLUDED.clean_reps,
         clean_share = EXCLUDED.clean_share, volume_kg = EXCLUDED.volume_kg,
         avg_range_deg = EXCLUDED.avg_range_deg, avg_quality = EXCLUDED.avg_quality,
         est_1rm_kg = EXCLUDED.est_1rm_kg, is_pr = EXCLUDED.is_pr, synced_at = now()`,
      [
        b.map((r) => r.neon_user_id),
        b.map((r) => r.date),
        b.map((r) => r.exercise_id),
        b.map((r) => num(r.sets)),
        b.map((r) => num(r.reps)),
        b.map((r) => num(r.clean_reps)),
        b.map((r) => num(r.clean_share)),
        b.map((r) => num(r.volume_kg)),
        b.map((r) => num(r.avg_range_deg)),
        b.map((r) => num(r.avg_quality)),
        b.map((r) => num(r.est_1rm_kg)),
        b.map((r) => r.is_pr ?? null),
      ],
    ).then(() => undefined),
  );
}

export async function upsertRisk(db: Db, rows: (RiskRow & { neon_user_id: string })[]) {
  await inBatches(rows, (b) =>
    db.query(
      `INSERT INTO risk_insights (user_id, body_part, as_of, score, explanation, top_features, synced_at)
       SELECT user_id, body_part, as_of, score, explanation, top_features::jsonb, now()
       FROM unnest($1::text[], $2::text[], $3::date[], $4::real[], $5::text[], $6::text[])
         AS t(user_id, body_part, as_of, score, explanation, top_features)
       ON CONFLICT (user_id, body_part, as_of) DO UPDATE SET
         score = EXCLUDED.score, explanation = EXCLUDED.explanation,
         top_features = EXCLUDED.top_features, synced_at = now()`,
      [
        b.map((r) => r.neon_user_id),
        b.map((r) => r.body_part),
        b.map((r) => r.date),
        b.map((r) => Number(r.score)),
        b.map((r) => explainRisk(r.body_part, r.top_features ?? [])),
        b.map((r) => JSON.stringify(r.top_features ?? [])),
      ],
    ).then(() => undefined),
  );
}

export async function upsertRom(db: Db, rows: (RomRow & { neon_user_id: string })[]) {
  await inBatches(rows, (b) =>
    db
      .query(
        `INSERT INTO rom_trend (user_id, angle, side, week, peak_range_deg, baseline_range_deg,
                                healthy_side_range_deg, change_deg, synced_at)
         SELECT *, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::date[], $5::real[], $6::real[],
                                     $7::real[], $8::real[])
         ON CONFLICT (user_id, angle, side, week) DO UPDATE SET
           peak_range_deg = EXCLUDED.peak_range_deg, baseline_range_deg = EXCLUDED.baseline_range_deg,
           healthy_side_range_deg = EXCLUDED.healthy_side_range_deg, change_deg = EXCLUDED.change_deg,
           synced_at = now()`,
        [
          b.map((r) => r.neon_user_id),
          b.map((r) => r.angle),
          b.map((r) => r.side),
          b.map((r) => r.week),
          b.map((r) => num(r.peak_range_deg)),
          b.map((r) => num(r.baseline_range_deg)),
          b.map((r) => num(r.healthy_side_range_deg)),
          b.map((r) => num(r.change_deg)),
        ],
      )
      .then(() => undefined),
  );
}

// ---- Job ----

// Console or pino: both take a plain message.
export interface LogLike {
  info(msg: string): void;
  error(msg: string): void;
}

export interface SyncDeps {
  db: Db;
  config: SyncConfig;
  read?: (cfg: SyncConfig, log: LogLike) => Promise<GoldSnapshot>; // injectable for tests
  log?: LogLike;
}

export interface SyncResult {
  progress: number;
  risk: number;
  rom: number;
  skipped_unknown_users: number;
  ms: number;
}

export async function runInsightSync({ db, config, read = readGold, log = console }: SyncDeps): Promise<SyncResult> {
  const started = Date.now();
  const gold = await read(config, log);

  const users = await rowsOf<{ id: string }>(db, "SELECT id FROM users");
  const byPseudonym = new Map(users.map((u) => [pseudonymize(String(u.id), config.pseudonymSecret), String(u.id)]));

  let skipped = 0;
  const resolve = <T extends { user_id: string }>(rows: T[]) =>
    rows.flatMap((r) => {
      const id = byPseudonym.get(r.user_id);
      if (!id) {
        skipped++;
        return [];
      }
      return [{ ...r, neon_user_id: id }];
    });

  const progress = resolve(gold.progress);
  const risk = resolve(gold.risk);
  const rom = resolve(gold.rom ?? []);
  await upsertProgress(db, progress);
  await upsertRisk(db, risk);
  await upsertRom(db, rom);

  return {
    progress: progress.length,
    risk: risk.length,
    rom: rom.length,
    skipped_unknown_users: skipped,
    ms: Date.now() - started,
  };
}

/** Runs once now, then every 15 minutes. Never overlaps itself. Returns a stop function. */
export function startInsightSync(deps: SyncDeps, intervalMs = SYNC_INTERVAL_MS): () => void {
  let running = false;
  const log = deps.log ?? console;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runInsightSync(deps);
      log.info(`[insights] synced ${r.progress} progress, ${r.risk} risk, ${r.rom} range-of-motion rows` +
        ` (${r.skipped_unknown_users} rows for unknown users) in ${r.ms} ms`);
    } catch (err) {
      // Leave Neon as it was; the next tick retries.
      log.error(`[insights] sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
