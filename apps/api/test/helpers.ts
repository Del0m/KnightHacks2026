// Test harness: real Postgres (PGlite, in-process WASM, with pgvector) running the real
// migrations, real JWT verification against local keys, and the real Express app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import request from "supertest";
import type { SetRecord } from "../../../specs/set-record/types.js";
import { createApp, type AppDeps } from "../src/app.js";
import { CASING, schema, type Db } from "../src/db.js";
import { jwtVerifier } from "../src/middleware/auth.js";
import type { ExportQueue, ExportSession } from "../src/services/exportQueue.js";

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "migrations",
);

export async function createTestDb() {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client, schema, casing: CASING });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, client, close: () => client.close() };
}

export const ISSUER = "https://auth.test.spotter";

export async function createKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const verify = jwtVerifier(createLocalJWKSet({ keys: [jwk] }), { issuer: ISSUER });
  const sign = (sub: string, opts: { expiresIn?: string; issuer?: string } = {}) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(sub)
      .setIssuer(opts.issuer ?? ISSUER)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "1h")
      .sign(privateKey);
  return { verify, sign, privateKey };
}

export function recordingQueue(): ExportQueue & { sessions: ExportSession[] } {
  const sessions: ExportSession[] = [];
  return { sessions, enqueue: (s) => void sessions.push(s) };
}

export async function setup(overrides: Partial<AppDeps> & { close?: () => Promise<void> } = {}) {
  const created = overrides.db ? null : await createTestDb();
  const db = overrides.db ?? created!.db;
  const close = overrides.close ?? created?.close ?? (async () => {});
  const keys = await createKeys();
  const queue = recordingQueue();
  const app = createApp({ db, verifyToken: keys.verify, exportQueue: queue, ...overrides });

  // An authenticated supertest agent for a user id.
  const as = async (sub: string) => {
    const token = await keys.sign(sub);
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(app).get(url)),
      post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
      put: (url: string, body?: object) => auth(request(app).put(url)).send(body ?? {}),
      delete: (url: string) => auth(request(app).delete(url)),
    };
  };

  return { app, db, close, keys, queue, as };
}

// A rep as the phone sends it (AI-08 set record).
export function rep(flags: string[] = [], overrides: Record<string, unknown> = {}) {
  return {
    rep_index: 0,
    start_ms: null,
    end_ms: null,
    lowering_ms: null,
    rising_ms: null,
    tempo_ms: 2000,
    range_deg: 95,
    quality: flags.length ? 0.5 : 0.95,
    flags: flags.map((rule_id) => ({ rule_id, severity: "form", rep_index: 0 })),
    ...overrides,
  };
}

export function setRecord(input: { reps: object[]; [key: string]: unknown }): SetRecord {
  return {
    schema_version: 1,
    set_index: 0,
    exercise_id: "squat",
    weight_kg: null,
    end_reason: "manual",
    partial_reps: 0,
    fps: null,
    frames: [],
    ...input,
    reps: input.reps.map((value, index) => {
      const valueWithDefaults = { ...rep(), ...value };
      return {
        ...valueWithDefaults,
        rep_index: index,
        flags: valueWithDefaults.flags.map((flag) => ({ ...flag, rep_index: index })),
      };
    }),
  } as SetRecord;
}

export function frames(n: number) {
  return Array.from({ length: n }, (_, i) => ({ t_ms: i * 33, kp: Array.from({ length: 51 }, () => 0.5) }));
}
