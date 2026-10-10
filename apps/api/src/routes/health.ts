// BE-01 / BE-14: liveness for the host's health check, readiness that also pings Neon.
import { sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "../db.js";

export function healthRouter(db: Db): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime_s: Math.round(process.uptime()) });
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
