// BE-06: exercise library and per-exercise form specs. Public, so the app can cache specs before sign-in.
import { asc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { notFound, parse, send } from "../http.js";

const { exercises } = schema;

export function exercisesRouter(db: Db): Router {
  const router = Router();

  router.get("/exercises", async (_req, res) => {
    const rows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        muscles: exercises.muscles,
        level: exercises.level,
        hasSpec: sql<boolean>`${exercises.formSpec} is not null`,
      })
      .from(exercises)
      .orderBy(asc(exercises.name));
    res.set("Cache-Control", "public, max-age=300");
    send(res, rows);
  });

  router.get("/exercises/:id/spec", async (req, res) => {
    const id = parse(z.string().max(60), req.params.id);
    const [row] = await db
      .select({ spec: exercises.formSpec, updatedAt: exercises.updatedAt })
      .from(exercises)
      .where(eq(exercises.id, id));
    if (!row?.spec) throw notFound("Exercise spec");
    res.set("Cache-Control", "public, max-age=300");
    res.set("Last-Modified", row.updatedAt.toUTCString());
    // The spec is AI-05's JSON, returned exactly as written (no key conversion).
    res.json(row.spec);
  });

  return router;
}
