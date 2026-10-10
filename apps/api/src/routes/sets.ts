// BE-07: GET /sets/:id/rest-note returns the rest note and score saved with a set (INT-05), so a
// reload or the history screen shows exactly what the rest card showed. A set saved before INT-05
// gets the phone score and the fixed note, computed once and saved.
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { notFound, parse, send, userId } from "../http.js";
import { BEGINNER_BASELINE, phoneScore, type SetScore } from "../integrations/databricks/score.js";
import { fixedNote, type RestNote, type SpecRule } from "../services/restNote.js";

const { sets, sessions, reps, formFlags, exercises } = schema;

export function setsRouter(db: Db): Router {
  const router = Router();

  router.get("/sets/:id/rest-note", async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [set] = await db
      .select({ set: sets })
      .from(sets)
      .innerJoin(sessions, eq(sessions.id, sets.sessionId))
      .where(and(eq(sets.id, id), eq(sessions.userId, userId(req))));
    if (!set) throw notFound("Set");

    let score = set.set.score as SetScore | null;
    let note = set.set.restNote as RestNote | null;
    if (!score || !note) {
      const repRows = await db.select().from(reps).where(eq(reps.setId, id)).orderBy(asc(reps.position));
      const flagRows = repRows.length
        ? await db
            .select()
            .from(formFlags)
            .where(
              inArray(
                formFlags.repId,
                repRows.map((r) => r.id),
              ),
            )
        : [];
      const repFlags = repRows.map((r) => ({
        tempo_ms: r.tempoMs,
        range_deg: r.rangeDeg,
        quality: r.quality,
        flags: flagRows.filter((f) => f.repId === r.id).map((f) => ({ rule_id: f.ruleId })),
      }));
      const [exercise] = await db
        .select({ name: exercises.name, spec: exercises.formSpec })
        .from(exercises)
        .where(eq(exercises.id, set.set.exerciseId));
      const rules = ((exercise?.spec as { rules?: SpecRule[] } | null)?.rules ?? []) as SpecRule[];
      score ??= phoneScore(
        {
          exercise_id: set.set.exerciseId,
          weight_kg: set.set.weightKg,
          reps: repFlags,
          baseline_share: BEGINNER_BASELINE,
        },
        Date.now(),
        "scored after the fact",
      );
      note ??= fixedNote({ exerciseName: exercise?.name ?? set.set.exerciseId, rules, reps: repFlags });
      await db.update(sets).set({ score, restNote: note }).where(eq(sets.id, id));
    }
    send(res, { set_id: id, score, rest_note: note });
  });

  return router;
}
