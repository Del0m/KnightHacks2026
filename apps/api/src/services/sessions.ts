// BE-04: session lifecycle. Finishing computes the medal and PRs (BE-05), writes opt-in feed
// posts (BE-10) in the same transaction, then queues the Databricks export (CONN-02).
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { conflict, isUniqueViolation, notFound } from "../http.js";
import type { Logger } from "pino";
import { injuryGroup } from "../integrations/databricks/upload.js";
import type { BufferedSetJoints, ExportQueue, ExportSession, JointsBuffer } from "./exportQueue.js";
import {
  BASELINE_WINDOW_DAYS,
  baselineShare,
  detectPrs,
  formScore,
  pickWorkoutMedal,
  sessionBests,
  type MedalTier,
  type PrMetric,
  type PrResult,
} from "./medals.js";

const { sessions, sets, reps, formFlags, medals, personalRecords, profiles, injuries, posts, rehabPlans } =
  schema;

export interface NewSet {
  setIndex?: number;
  exerciseId: string;
  weightKg: number | null;
  medal?: MedalTier | null;
  cleanShare?: number | null;
  scoreSource?: "databricks" | "phone" | null;
  fps?: number;
  frames?: { t_ms: number; kp: number[] }[];
  reps: {
    tempoMs: number;
    rangeDeg: number;
    quality?: number | null;
    clean?: boolean;
    startMs?: number | null;
    endMs?: number | null;
    flags: { ruleId: string; severity?: string }[];
  }[];
}

export interface FinishResult {
  sessionId: string;
  finishedAt: Date;
  medal: MedalTier;
  formScore: number;
  baselineShare: number;
  totalReps: number;
  cleanReps: number;
  personalRecords: PrResult[];
  posts: { id: string; kind: string }[];
}

async function ownSession(db: Db, userId: string, sessionId: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Session");
  return row;
}

export async function addSet(db: Db, joints: JointsBuffer, userId: string, sessionId: string, input: NewSet) {
  let position = input.setIndex;
  try {
    const result = await db.transaction(async (tx) => {
      // Lock the session row. Concurrent sets for the same session then take turns, so they can't
      // pick the same position, and none can land after finishSession (which takes the same lock)
      // has computed the medal.
      const [session] = await tx
        .select({ finishedAt: sessions.finishedAt })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .for("update")
        .limit(1);
      if (!session) throw notFound("Session");
      if (session.finishedAt) throw conflict("This session is already finished");

      // After the highest position, not count(*): explicit set_index values can leave gaps.
      position ??= (
        await tx
          .select({ next: sql<number>`coalesce(max(${sets.position}) + 1, 0)::int` })
          .from(sets)
          .where(eq(sets.sessionId, sessionId))
      )[0]!.next;

      const repRows = input.reps.map((r, i) => ({
        position: i,
        tempoMs: Math.round(r.tempoMs),
        rangeDeg: r.rangeDeg,
        quality: r.quality ?? null,
        clean: r.clean ?? r.flags.length === 0,
        startMs: r.startMs ?? null,
        endMs: r.endMs ?? null,
      }));
      const cleanCount = repRows.filter((r) => r.clean).length;

      const [set] = await tx
        .insert(sets)
        .values({
          sessionId,
          position,
          exerciseId: input.exerciseId,
          reps: repRows.length,
          weightKg: input.weightKg,
          medal: input.medal ?? null,
          cleanShare: input.cleanShare ?? (repRows.length ? cleanCount / repRows.length : null),
          scoreSource: input.scoreSource ?? null,
        })
        .returning();

      if (repRows.length) {
        const inserted = await tx
          .insert(reps)
          .values(repRows.map((r) => ({ ...r, setId: set!.id })))
          .returning({ id: reps.id, position: reps.position });
        const flagRows = inserted.flatMap((rep) =>
          input.reps[rep.position]!.flags.map((f) => ({
            repId: rep.id,
            ruleId: f.ruleId,
            severity: f.severity ?? "info",
          })),
        );
        if (flagRows.length) await tx.insert(formFlags).values(flagRows);
      }
      return { ...set!, cleanReps: cleanCount };
    });

    if (input.frames?.length) {
      joints.put(sessionId, result.position, { fps: input.fps ?? 0, frames: input.frames });
    }
    return result;
  } catch (err) {
    // Only an explicit set_index can collide now; auto positions are assigned under the lock.
    if (isUniqueViolation(err)) throw conflict(`Set ${position} was already recorded for this session`);
    throw err;
  }
}

export interface FinishDeps {
  exportQueue: ExportQueue;
  joints: JointsBuffer;
  log?: Pick<Logger, "error">;
}

export async function finishSession(
  db: Db,
  deps: FinishDeps,
  userId: string,
  sessionId: string,
  finishedAt = new Date(),
): Promise<FinishResult> {
  const { result, exportSession } = await db.transaction(async (tx) => {
    // Lock the row so two concurrent finish calls can't both award a medal.
    const [session] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .for("update")
      .limit(1);
    if (!session) throw notFound("Session");
    if (session.finishedAt) throw conflict("This session is already finished");

    const [counts] = await tx
      .select({
        total: sql<number>`count(${reps.id})::int`,
        clean: sql<number>`count(${reps.id}) filter (where ${reps.clean})::int`,
      })
      .from(reps)
      .innerJoin(sets, eq(reps.setId, sets.id))
      .where(eq(sets.sessionId, sessionId));
    const totalReps = counts?.total ?? 0;
    const cleanReps = counts?.clean ?? 0;

    const windowStart = new Date(finishedAt.getTime() - BASELINE_WINDOW_DAYS * 86_400_000);
    const previous = await tx
      .select({ score: sessions.formScore })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.id, sessionId),
          isNotNull(sessions.formScore),
          gte(sessions.finishedAt, windowStart),
          lt(sessions.finishedAt, finishedAt),
        ),
      );
    const baseline = baselineShare(previous.map((p) => p.score!));
    const score = formScore(cleanReps, totalReps);
    const tier = pickWorkoutMedal(cleanReps, totalReps, baseline);

    // Personal records against everything before this session.
    const setRows = await tx
      .select({ exerciseId: sets.exerciseId, reps: sets.reps, weightKg: sets.weightKg })
      .from(sets)
      .where(eq(sets.sessionId, sessionId));
    const candidates = sessionBests(setRows);
    const exerciseIds = [...new Set(candidates.map((c) => c.exerciseId))];
    const bestRows = exerciseIds.length
      ? await tx
          .select({
            exerciseId: personalRecords.exerciseId,
            metric: personalRecords.metric,
            best: sql<number>`max(${personalRecords.value})`,
          })
          .from(personalRecords)
          .where(and(eq(personalRecords.userId, userId), inArray(personalRecords.exerciseId, exerciseIds)))
          .groupBy(personalRecords.exerciseId, personalRecords.metric)
      : [];
    const best = new Map(bestRows.map((b) => [`${b.exerciseId}\u0000${b.metric}`, Number(b.best)]));
    const prs = detectPrs(candidates, (exerciseId: string, metric: PrMetric) => {
      return best.get(`${exerciseId}\u0000${metric}`) ?? null;
    });

    await tx
      .update(sessions)
      .set({ finishedAt, formScore: score, medal: tier })
      .where(eq(sessions.id, sessionId));
    await tx.insert(medals).values({
      userId,
      sessionId,
      tier,
      formScore: score,
      baselineShare: baseline,
      awardedAt: finishedAt,
    });
    if (prs.length) {
      await tx.insert(personalRecords).values(
        prs.map((p) => ({
          userId,
          exerciseId: p.exerciseId,
          metric: p.metric,
          value: p.value,
          previousValue: p.previousValue,
          sessionId,
          achievedAt: finishedAt,
        })),
      );
    }

    // Opt-in auto posts (BE-10). System-written text, so it skips moderation.
    const [profile] = await tx
      .select({ autoPostMedals: profiles.autoPostMedals, autoPostPrs: profiles.autoPostPrs })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    const newPosts: (typeof posts.$inferInsert)[] = [];
    if (profile?.autoPostMedals) {
      newPosts.push({
        authorId: userId,
        kind: "medal",
        sessionId,
        body: medalPostBody(tier, cleanReps, totalReps),
        data: { tier, form_score: score, clean_reps: cleanReps, total_reps: totalReps },
        createdAt: finishedAt,
      });
    }
    if (profile?.autoPostPrs) {
      for (const pr of prs.filter((p) => p.metric !== "est_1rm_kg")) {
        newPosts.push({
          authorId: userId,
          kind: "pr",
          sessionId,
          body: prPostBody(pr),
          data: {
            exercise_id: pr.exerciseId,
            metric: pr.metric,
            value: pr.value,
            previous_value: pr.previousValue,
          },
          createdAt: finishedAt,
        });
      }
    }
    const createdPosts = newPosts.length
      ? await tx.insert(posts).values(newPosts).returning({ id: posts.id, kind: posts.kind })
      : [];

    // Built inside the transaction: if any of these reads fail, the finish rolls back and the
    // client can retry, instead of the session being finished without the client ever seeing
    // its medal. Joints are only peeked here and drained after commit, so a retry still has them.
    const exportSession = await buildExportSession(tx, userId, sessionId, deps.joints.peek(sessionId));

    const result: FinishResult = {
      sessionId,
      finishedAt,
      medal: tier,
      formScore: score,
      baselineShare: baseline,
      totalReps,
      cleanReps,
      personalRecords: prs,
      posts: createdPosts,
    };
    return { result, exportSession };
  });

  // After commit, nothing touches the database, so a finished session can't turn into a 500.
  // The queue only uploads sessions whose finish committed.
  deps.joints.take(sessionId);
  try {
    deps.exportQueue.enqueue(exportSession);
  } catch (err) {
    // The medal is saved and export_status stays "pending", so the session can be re-exported later.
    deps.log?.error({ err, sessionId }, "could not queue databricks export");
  }
  return result;
}

export async function buildExportSession(
  db: Db,
  userId: string,
  sessionId: string,
  frames: ReadonlyMap<number, BufferedSetJoints> = new Map(),
): Promise<ExportSession> {
  const session = await ownSession(db, userId, sessionId);
  const setRows = await db
    .select()
    .from(sets)
    .where(eq(sets.sessionId, sessionId))
    .orderBy(asc(sets.position));
  const setIds = setRows.map((s) => s.id);
  const repRows = setIds.length
    ? await db
        .select()
        .from(reps)
        .where(inArray(reps.setId, setIds))
        .orderBy(asc(reps.setId), asc(reps.position))
    : [];
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
  const [profile] = await db
    .select({ level: profiles.experienceLevel })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const injuryRows = await db
    .selectDistinct({ part: injuries.bodyPart, side: injuries.side })
    .from(injuries)
    .where(eq(injuries.userId, userId));
  const [activePlan] = await db
    .select({ startOn: rehabPlans.startOn })
    .from(rehabPlans)
    .where(and(eq(rehabPlans.userId, userId), eq(rehabPlans.status, "active")));

  return {
    id: session.id,
    user_id: userId, // pseudonymized by the uploader
    started_at: session.startedAt.toISOString(),
    finished_at: (session.finishedAt ?? new Date()).toISOString(),
    device: session.device ?? "unknown",
    inference_mode: session.inferenceMode,
    medal: session.medal,
    form_score: session.formScore,
    experience_level: profile?.level ?? null,
    // The injured side and the rehab plan's start let range of motion (CONN-14) compare the
    // right sides from the right baseline. Coarse tags only, never notes or dates (§13).
    injury_groups: [...new Set(injuryRows.map((i) => injuryGroup(i.part, i.side)))],
    // Only once the plan has started by this session's date, so ROM never gets a baseline from
    // the future. The session's UTC date is close enough here: it only picks the baseline window.
    rehab_start_on:
      activePlan && activePlan.startOn <= (session.finishedAt ?? new Date()).toISOString().slice(0, 10)
        ? activePlan.startOn
        : null,
    sets: setRows.map((s) => ({
      exercise_id: s.exerciseId,
      weight_kg: s.weightKg,
      medal: s.medal,
      fps: frames.get(s.position)?.fps ?? 0,
      frames: frames.get(s.position)?.frames ?? [],
      reps: repRows
        .filter((r) => r.setId === s.id)
        .map((r) => ({
          start_ms: r.startMs ?? null, // unknown, not 0: 0..0 would fail the pipeline's bounds check
          end_ms: r.endMs ?? null,
          tempo_ms: r.tempoMs,
          range_deg: r.rangeDeg,
          quality: r.quality ?? (r.clean ? 1 : 0),
          flags: flagRows
            .filter((f) => f.repId === r.id)
            .map((f) => ({ rule_id: f.ruleId, severity: f.severity })),
        })),
    })),
  };
}

// Feed copy follows §7: describe what happened, good news first, never "bad" or "wrong".
export function medalPostBody(tier: MedalTier, cleanReps: number, totalReps: number): string {
  if (tier === "gold") return "Finished a gold-level workout";
  if (tier === "silver") return `Finished a silver workout: ${cleanReps} of ${totalReps} reps clean`;
  return "Finished a bronze workout. Showing up counts.";
}

const EXERCISE_NAMES: Record<string, string> = {
  squat: "squat",
  push_up: "push-up",
  bicep_curl: "bicep curl",
  shoulder_press: "shoulder press",
  lunge: "lunge",
};

export function prPostBody(pr: PrResult): string {
  const name = EXERCISE_NAMES[pr.exerciseId] ?? pr.exerciseId.replace(/_/g, " ");
  return pr.metric === "max_reps"
    ? `New ${name} PR: ${pr.value} reps in one set`
    : `New ${name} PR: ${pr.value} kg`;
}
