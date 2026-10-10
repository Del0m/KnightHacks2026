// BE-04: POST /sessions, POST /sessions/:id/sets, POST /sessions/:id/finish.
//
// The set payload is the phone's set record (AI-08), the same shape the Databricks uploader
// sends (FinishedSet in integrations/databricks/upload.ts): per-rep aggregates and flags, plus
// optional per-frame joints. Aggregates go to Neon; joints only go to Databricks.
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { parse, send, userId } from "../http.js";
import { JOINT_COUNT, VALUES_PER_JOINT } from "../integrations/databricks/upload.js";
import { RestNoteWriter } from "../services/restNote.js";
import { restTimeResult } from "../services/restTime.js";
import { addSet, finishSession, type FinishDeps } from "../services/sessions.js";

const noLlmNotes = new RestNoteWriter(null); // fixed notes when no LLM is configured

const MAX_FRAMES_PER_SET = 30 * 60 * 3; // 3 minutes at 30 fps

export const createSessionInput = z
  .object({
    started_at: z.string().datetime({ offset: true }).optional(),
    device: z.string().max(120).optional(),
    inference_mode: z.enum(["on_device", "cloud"]).default("on_device"),
  })
  .strict();

const flag = z.object({ rule_id: z.string().min(1).max(60), severity: z.string().max(20).optional() });

const rep = z.object({
  tempo_ms: z.number().nonnegative().max(120_000),
  range_deg: z.number().min(0).max(360),
  quality: z.number().min(0).max(1).nullable().optional(),
  // Accepted for older clients but ignored (INT-06): a rep is clean when it has no rule flags.
  clean: z.boolean().optional(),
  start_ms: z.number().int().nonnegative().nullable().optional(),
  end_ms: z.number().int().nonnegative().nullable().optional(),
  flags: z.array(flag).max(20).default([]),
});

const frame = z.object({
  t_ms: z.number().nonnegative(),
  kp: z
    .array(z.number().finite())
    .length(JOINT_COUNT * VALUES_PER_JOINT, `kp must hold ${JOINT_COUNT} joints x (x, y, c)`),
});

export const setInput = z.object({
  set_index: z.number().int().min(0).max(200).optional(),
  exercise_id: z
    .string()
    .regex(/^[a-z0-9_]{2,60}$/)
    .max(60),
  weight_kg: z.number().min(0).max(1000).nullable().default(null),
  medal: z.enum(["bronze", "silver", "gold"]).nullable().optional(),
  // Accepted for older clients but ignored (INT-06): the server derives the set's clean share
  // from the rule flags, and its medal from that (INT-05 rest-time result).
  clean_share: z.number().min(0).max(1).nullable().optional(),
  score_source: z.enum(["databricks", "phone"]).nullable().optional(),
  fps: z.number().positive().max(240).optional(),
  frames: z.array(frame).max(MAX_FRAMES_PER_SET).optional(),
  reps: z.array(rep).max(200),
});

export const finishInput = z
  .object({ finished_at: z.string().datetime({ offset: true }).optional() })
  .strict()
  .default({});

export function sessionsRouter(db: Db, deps: FinishDeps): Router {
  const router = Router();

  router.post("/sessions", async (req, res) => {
    const input = parse(createSessionInput, req.body ?? {});
    const [row] = await db
      .insert(schema.sessions)
      .values({
        userId: userId(req),
        startedAt: input.started_at ? new Date(input.started_at) : new Date(),
        device: input.device ?? null,
        inferenceMode: input.inference_mode,
      })
      .returning();
    send(res, row, 201);
  });

  // INT-05: one round trip saves the set, scores it and returns its rest note.
  router.post("/sessions/:id/sets", async (req, res) => {
    const sessionId = parse(z.string().uuid(), req.params.id);
    const input = parse(setInput, req.body);
    const me = userId(req);
    const savedAt = Date.now();
    const set = await addSet(db, deps.joints, me, sessionId, {
      setIndex: input.set_index,
      exerciseId: input.exercise_id,
      weightKg: input.weight_kg,
      medal: input.medal,
      cleanShare: input.clean_share,
      scoreSource: input.score_source,
      fps: input.fps,
      frames: input.frames,
      reps: input.reps.map((r) => ({
        tempoMs: r.tempo_ms,
        rangeDeg: r.range_deg,
        quality: r.quality,
        clean: r.clean,
        startMs: r.start_ms,
        endMs: r.end_ms,
        flags: r.flags.map((f) => ({ ruleId: f.rule_id, severity: f.severity })),
      })),
    });
    const rest = await restTimeResult(db, deps.rest ?? { notes: noLlmNotes }, {
      userId: me,
      setId: set.id,
      exerciseId: input.exercise_id,
      weightKg: input.weight_kg ?? null,
      saveMs: Date.now() - savedAt,
      reps: input.reps.map((r) => ({
        rangeDeg: r.range_deg,
        tempoMs: r.tempo_ms,
        quality: r.quality,
        flags: r.flags.map((f) => ({ ruleId: f.rule_id })),
      })),
    });
    deps.log?.info(
      {
        setId: set.id,
        scoreSource: rest.score.source,
        noteSource: rest.rest_note.source,
        ...rest.timings_ms,
      },
      "rest-time result",
    );
    send(
      res,
      {
        ...set,
        medal: rest.score.medal,
        cleanShare: rest.score.clean_share,
        scoreSource: rest.score.source,
        set_id: set.id,
        ...rest,
      },
      201,
    );
  });

  router.post("/sessions/:id/finish", async (req, res) => {
    const sessionId = parse(z.string().uuid(), req.params.id);
    const input = parse(finishInput, req.body ?? {});
    const result = await finishSession(
      db,
      deps,
      userId(req),
      sessionId,
      input.finished_at ? new Date(input.finished_at) : new Date(),
    );
    send(res, result);
  });

  return router;
}
