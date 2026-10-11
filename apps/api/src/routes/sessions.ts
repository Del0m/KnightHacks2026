// BE-04: POST /sessions, POST /sessions/:id/sets, POST /sessions/:id/finish.
//
// The set payload is the shared phone set record (AI-08): per-rep aggregates and flags,
// plus per-frame joints. Aggregates go to Neon; joints only go to Databricks.
import { Router } from "express";
import { z } from "zod";
import type { SessionStart, SetRecord } from "../../../../specs/set-record/types.js";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { parse, send, userId } from "../http.js";
import { JOINT_COUNT, VALUES_PER_JOINT } from "../integrations/databricks/upload.js";
import { RestNoteWriter } from "../services/restNote.js";
import { restTimeResult } from "../services/restTime.js";
import { addSet, finishSession, type FinishDeps } from "../services/sessions.js";

const noLlmNotes = new RestNoteWriter(null); // fixed notes when no LLM is configured

const MAX_FRAMES_PER_SET = 30 * 60 * 3; // 3 minutes at 30 fps

export const createSessionInput: z.ZodType<SessionStart, z.ZodTypeDef, unknown> = z.object({
  started_at: z.string().datetime({ offset: true }).optional(),
  device: z.string().max(120).optional(),
  inference_mode: z.enum(["coreml", "vision", "cloud"]),
});

const flag = z.object({
  rule_id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  severity: z.enum(["form", "safety"]),
  rep_index: z.number().int().nonnegative(),
});

const rep = z.object({
  rep_index: z.number().int().nonnegative(),
  tempo_ms: z.number().int().nonnegative().max(120_000),
  range_deg: z.number().finite().min(0).max(180),
  quality: z.number().min(0).max(1).nullable(),
  start_ms: z.number().int().nonnegative().nullable(),
  end_ms: z.number().int().nonnegative().nullable(),
  lowering_ms: z.number().int().nonnegative().nullable(),
  rising_ms: z.number().int().nonnegative().nullable(),
  flags: z.array(flag).max(20),
});

const frame = z.object({
  t_ms: z.number().int().nonnegative(),
  kp: z
    .array(z.number().finite())
    .length(JOINT_COUNT * VALUES_PER_JOINT, `kp must hold ${JOINT_COUNT} joints x (x, y, c)`),
});

export const setInput: z.ZodType<SetRecord, z.ZodTypeDef, unknown> = z
  .object({
    schema_version: z.literal(1),
    set_index: z.number().int().min(0).max(200),
    exercise_id: z
      .string()
      .regex(/^[a-z0-9_]{2,60}$/)
      .max(60),
    weight_kg: z.number().min(0).max(1000).nullable(),
    end_reason: z.enum(["still", "absent", "lost", "manual"]),
    partial_reps: z.number().int().nonnegative(),
    fps: z.number().positive().max(240).nullable(),
    frames: z.array(frame).max(MAX_FRAMES_PER_SET),
    reps: z.array(rep).max(200),
  })
  .superRefine((set, context) => {
    const problem = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    set.reps.forEach((rep, index) => {
      if (rep.rep_index !== index) problem(["reps", index, "rep_index"], "Must equal the rep array index");
      rep.flags.forEach((flag, flagIndex) => {
        if (flag.rep_index !== rep.rep_index)
          problem(["reps", index, "flags", flagIndex, "rep_index"], "Must equal the containing rep index");
      });
      if (rep.start_ms !== null && rep.end_ms !== null && rep.end_ms - rep.start_ms !== rep.tempo_ms)
        problem(["reps", index, "end_ms"], "end_ms - start_ms must equal tempo_ms");
      if (rep.lowering_ms !== null && rep.lowering_ms > rep.tempo_ms)
        problem(["reps", index, "lowering_ms"], "Cannot exceed tempo_ms");
      if (rep.rising_ms !== null && rep.rising_ms > rep.tempo_ms)
        problem(["reps", index, "rising_ms"], "Cannot exceed tempo_ms");
      if (
        rep.lowering_ms !== null &&
        rep.rising_ms !== null &&
        rep.lowering_ms + rep.rising_ms !== rep.tempo_ms
      )
        problem(["reps", index, "rising_ms"], "lowering_ms + rising_ms must equal tempo_ms");
    });
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
      endReason: input.end_reason,
      partialReps: input.partial_reps,
      fps: input.fps,
      frames: input.frames,
      reps: input.reps.map((r) => ({
        tempoMs: r.tempo_ms,
        rangeDeg: r.range_deg,
        quality: r.quality,
        startMs: r.start_ms,
        endMs: r.end_ms,
        loweringMs: r.lowering_ms,
        risingMs: r.rising_ms,
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
        loweringMs: r.lowering_ms,
        quality: r.quality,
        startMs: r.start_ms,
        endMs: r.end_ms,
        flags: r.flags.map((f) => ({ ruleId: f.rule_id })),
      })),
      frames: input.frames,
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
