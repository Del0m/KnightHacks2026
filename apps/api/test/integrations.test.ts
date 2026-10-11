// INT-04: one validated env, per-integration state on GET /health, and the insight sync's
// INSIGHT_SYNC_ENABLED gate.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { insightSyncConfigured, insightSyncEnabled, loadEnv } from "../src/env.js";
import { startInsightSync, type SyncConfig } from "../src/jobs/syncInsights.js";
import { IntegrationStatus, reasonOf, tracked } from "../src/services/integrationStatus.js";
import { setup } from "./helpers.js";

const REQUIRED = {
  DATABASE_URL: "postgresql://user:pw@ep-test-pooler.example.neon.tech/neondb",
  NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
};
const DATABRICKS = {
  DATABRICKS_HOST: "https://dbc-secret-host.cloud.databricks.com",
  DATABRICKS_CLIENT_ID: "client-id-value",
  DATABRICKS_CLIENT_SECRET: "client-secret-value",
  STEADYFORUM_PSEUDONYM_SECRET: "pseudonym-secret-value",
  DATABRICKS_WAREHOUSE_ID: "warehouse-id-value",
};

describe("env", () => {
  it("allows the website and local preview by default while preserving an explicit CORS allowlist", () => {
    const origins = loadEnv(REQUIRED).CORS_ORIGINS?.split(",");
    expect(origins).toEqual(["https://steadyforum.fit", "https://www.steadyforum.fit", "http://localhost:4173", "http://127.0.0.1:4173"]);
    expect(loadEnv({ ...REQUIRED, CORS_ORIGINS: "https://custom.example.com" }).CORS_ORIGINS).toBe("https://custom.example.com");
    expect(origins).not.toContain("*");
  });
  it("boots with only Neon and auth; Databricks and Hugging Face are optional", () => {
    const env = loadEnv(REQUIRED);
    expect(env.HF_TOKEN).toBeUndefined();
    expect(insightSyncConfigured(env)).toBe(false);
    expect(() => loadEnv({ NEON_AUTH_JWKS_URL: REQUIRED.NEON_AUTH_JWKS_URL })).toThrow(/DATABASE_URL/);
  });

  it("runs the insight sync only where INSIGHT_SYNC_ENABLED=true", () => {
    expect(insightSyncEnabled(loadEnv({ ...REQUIRED, ...DATABRICKS }))).toBe(false);
    expect(insightSyncEnabled(loadEnv({ ...REQUIRED, ...DATABRICKS, INSIGHT_SYNC_ENABLED: "false" }))).toBe(
      false,
    );
    expect(insightSyncEnabled(loadEnv({ ...REQUIRED, ...DATABRICKS, INSIGHT_SYNC_ENABLED: "true" }))).toBe(
      true,
    );
    // Enabled but not configured (no warehouse): still off.
    const { DATABRICKS_WAREHOUSE_ID: _w, ...noWarehouse } = DATABRICKS;
    expect(insightSyncEnabled(loadEnv({ ...REQUIRED, ...noWarehouse, INSIGHT_SYNC_ENABLED: "true" }))).toBe(
      false,
    );
    expect(() => loadEnv({ ...REQUIRED, INSIGHT_SYNC_ENABLED: "yes" })).toThrow(/INSIGHT_SYNC_ENABLED/);
  });
});

describe("integration status", () => {
  it("starts live or disabled, then follows the latest call; disabled stays disabled", async () => {
    let now = new Date("2026-10-11T01:00:00.000Z");
    const status = new IntegrationStatus(() => now);
    status.configure("llm", true);
    status.configure("cloud_pose", false);

    await tracked(status, "llm", async () => "note");
    expect(status.snapshot().llm).toEqual({ status: "live", last_ok_at: "2026-10-11T01:00:00.000Z" });

    now = new Date("2026-10-11T01:05:00.000Z");
    await expect(
      tracked(status, "llm", () =>
        Promise.reject(Object.assign(new Error("x"), { httpResponse: { status: 429 } })),
      ),
    ).rejects.toThrow("x");
    expect(status.snapshot().llm).toMatchObject({
      status: "error",
      reason: "http_429",
      last_error_at: "2026-10-11T01:05:00.000Z",
    });

    // A resolved call can still be a failure (a fallback), or say nothing (undefined).
    await tracked(
      status,
      "llm",
      async () => ({ source: "phone" }),
      () => "fallback",
    );
    expect(status.snapshot().llm).toMatchObject({ status: "error", reason: "fallback" });
    await tracked(
      status,
      "llm",
      async () => 1,
      () => undefined,
    );
    expect(status.snapshot().llm).toMatchObject({ status: "error", reason: "fallback" });
    await tracked(status, "llm", async () => 1);
    expect(status.snapshot().llm).toMatchObject({ status: "live", reason: undefined });

    status.fail("cloud_pose", "failed");
    expect(status.snapshot().cloud_pose).toEqual({ status: "disabled" });
  });

  it("reduces errors to coarse reasons without their messages", () => {
    expect(reasonOf(new Error("The operation was aborted due to timeout"))).toBe("timeout");
    expect(reasonOf(new Error("token HTTP 403: not authorized for https://dbc-secret-host"))).toBe(
      "http_403",
    );
    expect(reasonOf({ statusCode: 503 })).toBe("http_503");
    expect(reasonOf(new Error("warehouse-id-value missing"))).toBe("failed");
  });

  it("records each insight sync run: ok, a partial read, or a failure", async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const config = { pseudonymSecret: "s" } as SyncConfig;
    // One run on a fresh status; resolves with what it recorded.
    const run = async (read: () => Promise<unknown>) => {
      const status = new IntegrationStatus();
      status.configure("insight_sync", true);
      const stop = startInsightSync(
        { db, config, read: read as never, log: { info() {}, error() {} }, status },
        60_000,
      );
      await vi.waitFor(() => {
        const r = status.snapshot().insight_sync!;
        expect(r.last_ok_at ?? r.last_error_at).toBeDefined();
      });
      stop();
      return status.snapshot().insight_sync;
    };

    expect(await run(async () => ({ progress: [], risk: [], rom: [], failed: [] }))).toMatchObject({
      status: "live",
    });
    expect(
      await run(async () => ({
        progress: [],
        risk: [],
        rom: null,
        failed: [{ table: "gold_rom_trend", error: "x" }],
      })),
    ).toMatchObject({ status: "error", reason: "partial" });
    expect(await run(async () => Promise.reject(new Error("token HTTP 403: nope")))).toMatchObject({
      status: "error",
      reason: "http_403",
    });
  });
});

describe("GET /health", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const status = new IntegrationStatus();
  beforeAll(async () => {
    status.configure("databricks_export", true);
    status.configure("insight_sync", true);
    status.configure("cloud_pose", false);
    status.fail("insight_sync", "http_403");
    t = await setup({ integrations: status, corsOrigins: loadEnv(REQUIRED).CORS_ORIGINS.split(",") });
  });
  afterAll(() => t.close());

  it("permits authenticated browser preflights only from the configured website origins", async () => {
    const allowed = await request(t.app).options("/me").set("Origin", "http://localhost:4173").set("Access-Control-Request-Headers", "authorization,content-type");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:4173");
    expect(allowed.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
    const denied = await request(t.app).options("/me").set("Origin", "https://untrusted.example.com");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("stays 200 and lists Neon and each integration as live, disabled or error", async () => {
    const res = await request(t.app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      integrations: {
        neon: { status: "live" },
        databricks_export: { status: "live" },
        insight_sync: { status: "error", reason: "http_403" },
        cloud_pose: { status: "disabled" },
      },
    });
  });

  it("never includes env values", async () => {
    const body = JSON.stringify((await request(t.app).get("/health")).body);
    for (const value of [...Object.values(DATABRICKS), ...Object.values(REQUIRED)])
      expect(body).not.toContain(value);
  });
});
