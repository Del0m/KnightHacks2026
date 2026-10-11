// BE-01 / BE-14: liveness for the host's health check, readiness that also pings Neon.
import { sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "../db.js";
import type { IntegrationStatus } from "../services/integrationStatus.js";

const NEON_PING_MS = 3000;

async function pingNeon(db: Db, timeoutMs: number): Promise<boolean> {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// INT-04: GET /health stays 200 for the host's liveness check and adds each integration's state
// (live, disabled or error, from services/integrationStatus.ts). Never any env values.
export function healthRouter(db: Db, status?: IntegrationStatus): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const neon = (await pingNeon(db, NEON_PING_MS))
      ? { status: "live" }
      : { status: "error", reason: "unreachable" };
    res.json({
      status: "ok",
      uptime_s: Math.round(process.uptime()),
      integrations: { neon, ...status?.snapshot() },
    });
  });

  // Neon scales to zero, so the first ping after idle can take a few seconds.
  router.get("/health/ready", async (_req, res) => {
    try {
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      res.json({ status: "ok", db: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", db: "unreachable" });
    }
  });

  return router;
}
