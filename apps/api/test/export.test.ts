// BE-04 -> CONN-02 wiring: a finished session goes through the real DatabricksUploader
// (with fetch faked) and export_status is written back to Neon.
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runExportRetry, STALE_AFTER_MS } from "../src/jobs/retryExports.js";
import { buildExportSession } from "../src/services/sessions.js";
import { schema } from "../src/db.js";
import {
  DatabricksUploader,
  pseudonymize,
  type UploadConfig,
} from "../src/integrations/databricks/upload.js";
import { databricksExportQueue, drizzleExportStatusStore } from "../src/services/exportQueue.js";
import { createTestDb, frames, rep, setup } from "./helpers.js";

const config: UploadConfig = {
  host: "https://dbc.example.cloud.databricks.com",
  clientId: "id",
  clientSecret: "secret",
  scopes: "files",
  volumePath: "/Volumes/spotter/raw/sessions",
  pseudonymSecret: "test-pseudonym-secret-123456",
  maxAttempts: 2,
  baseDelayMs: 1,
};

let t: Awaited<ReturnType<typeof setup>>;
const puts: { url: string; body: Buffer }[] = [];
let failPuts = false;
let queue: ReturnType<typeof databricksExportQueue>;

beforeAll(async () => {
  const { db, close } = await createTestDb();
  const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/oidc/v1/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (failPuts) return new Response("down", { status: 503 });
    puts.push({ url: u, body: Buffer.from(init!.body as Uint8Array) });
    return new Response(null, { status: 204 });
  });
  const uploader = new DatabricksUploader(config, drizzleExportStatusStore(db), fakeFetch as typeof fetch);
  queue = databricksExportQueue(uploader, pino({ level: "silent" }));
  t = await setup({ db, close, exportQueue: queue, pseudonymSecret: config.pseudonymSecret });
});
afterAll(() => t.close());

async function waitForStatus(sessionId: string, status: string) {
  for (let i = 0; i < 100; i++) {
    const [s] = await t.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (s?.exportStatus === status) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`export_status never became ${status}`);
}

describe("Databricks export on finish", () => {
  it("uploads joints then metadata with a pseudonymous id and marks the session exported", async () => {
    const api = await t.as("export-user");
    await api.post("/me/injuries", { body_part: "knee", notes: "private note" });
    const { id } = (await api.post("/sessions", { device: "iPhone" })).body;
    await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      weight_kg: 40,
      fps: 30,
      frames: frames(3),
      reps: [rep(), rep(["depth"], { start_ms: 0, end_ms: 2000 })],
    });
    await api.post(`/sessions/${id}/finish`);

    const session = await waitForStatus(id, "exported");
    expect(session.exportedAt).toBeInstanceOf(Date);

    expect(puts.map((p) => /\/sessions\/(joints|meta)\//.exec(p.url)?.[1])).toEqual(["joints", "meta"]);
    const meta = JSON.parse(puts[1]!.body.toString());
    expect(meta.user_id).toBe(pseudonymize("export-user", config.pseudonymSecret));
    expect(JSON.stringify(meta)).not.toContain("export-user");
    expect(JSON.stringify(meta)).not.toContain("private note");
    expect(meta.sets[0].reps).toHaveLength(2);
    expect(meta.sets[0].reps[1].flags).toEqual([{ rule_id: "depth", severity: "warn" }]);
    // Unknown rep boundaries go out as null, not 0..0, which the pipeline's bounds check would drop.
    expect(meta.sets[0].reps[0]).toMatchObject({ start_ms: null, end_ms: null });
    expect(meta.sets[0].reps[1]).toMatchObject({ start_ms: 0, end_ms: 2000 });

    const joints = gunzipSync(puts[0]!.body)
      .toString()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(joints[0]).toMatchObject({ session_id: id, set_index: 0, exercise_id: "squat", fps: 30 });
    expect(joints[0].frames).toHaveLength(3);

    // The users row stores the same pseudonym so the insight sync can map rows back.
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, "export-user"));
    expect(user?.pseudonym).toBe(meta.user_id);
  });

  it("marks the session failed when Databricks stays down, without failing the request", async () => {
    failPuts = true;
    const api = await t.as("export-user-2");
    const { id } = (await api.post("/sessions")).body;
    await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] });
    const res = await api.post(`/sessions/${id}/finish`);
    expect(res.status).toBe(200);
    const session = await waitForStatus(id, "failed");
    expect(session.exportError).toContain("503");
    expect(session.exportAttempts).toBe(1);
    failPuts = false;
    expect(await runExportRetry({ db: t.db, queue })).toMatchObject({
      exported: 1,
      failed: 0,
      without_joints: 0,
    });
    const recovered = await waitForStatus(id, "exported");
    expect(recovered.exportError).toBeNull();
    expect(recovered.exportAttempts).toBe(2);
  });
  it("rebuilds stale sessions after restart, skips active leases, and retries beyond ten attempts", async () => {
    const api = await t.as("restart-user");
    const { id } = (await api.post("/sessions")).body;
    await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] });
    await api.post(`/sessions/${id}/finish`);
    await waitForStatus(id, "exported");
    await t.db
      .update(schema.sessions)
      .set({
        exportStatus: "pending",
        exportAttempts: 12,
        finishedAt: new Date(Date.now() - STALE_AFTER_MS - 1000),
      })
      .where(eq(schema.sessions.id, id));
    expect(await runExportRetry({ db: t.db, queue })).toMatchObject({ exported: 1, without_joints: 1 });
    expect((await waitForStatus(id, "exported")).exportAttempts).toBe(13);
    await t.db
      .update(schema.sessions)
      .set({ exportStatus: "uploading", exportStartedAt: new Date() })
      .where(eq(schema.sessions.id, id));
    expect(await runExportRetry({ db: t.db, queue })).toMatchObject({ retried: 0 });
    await t.db
      .update(schema.sessions)
      .set({ exportStartedAt: new Date(Date.now() - STALE_AFTER_MS - 1000) })
      .where(eq(schema.sessions.id, id));
    expect(await runExportRetry({ db: t.db, queue })).toMatchObject({ exported: 1 });
  });
  it("claims a finished session atomically so two workers cannot upload it", async () => {
    const api = await t.as("claim-user");
    const { id } = (await api.post("/sessions")).body;
    await api.post(`/sessions/${id}/finish`);
    await waitForStatus(id, "exported");
    await t.db.update(schema.sessions).set({ exportStatus: "failed" }).where(eq(schema.sessions.id, id));
    const store = drizzleExportStatusStore(t.db);
    const claims = await Promise.all([store.claim!(id), store.claim!(id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await queue.exportNow(await buildExportSession(t.db, "claim-user", id))).toBe("uploading");
    await store.set(id, "exported");
  });
});
