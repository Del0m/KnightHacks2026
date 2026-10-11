// INT-09: replays a recorded or synthetic clip through the whole set path and returns a
// deterministic summary for the golden files:
//   1. engine (AI-06)       mobile form engine, imported straight from apps/mobile
//   2. rules (AI-07)        mobile form rules on the engine's events, flags per rep
//   3. set record (AI-08)   the phone's set recorder, fed the same poses and events
//   4. API                  the real Express app on PGlite with the real migrations
// Databricks (scoring, file upload) and Hugging Face (rest notes) run their real clients with
// fetch faked, so the requests they would send are what gets checked.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { InferenceClient } from "@huggingface/inference";
import { eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import { runClip } from "../../../mobile/src/engine/__fixtures__/run.js";
import { createFormEngine } from "../../../mobile/src/engine/engine.js";
import { isAbsentFrame, type Clip } from "../../../mobile/src/engine/recording.js";
import { createSetRules } from "../../../mobile/src/engine/rules.js";
import { createSetRecorder } from "../../../mobile/src/engine/setRecord.js";
import { getSpec } from "../../../mobile/src/engine/specs.js";
import type { EngineEvent } from "../../../mobile/src/engine/types.js";
import type { PoseResult } from "../../../mobile/src/pose/types.js";
import type { InferenceMode, JointFrame, SetRecord } from "../../../../specs/set-record/types.js";
import { schema } from "../../src/db.js";
import { DatabricksScorer } from "../../src/integrations/databricks/score.js";
import { DatabricksUploader, type UploadConfig } from "../../src/integrations/databricks/upload.js";
import { HfLlm } from "../../src/integrations/huggingface/llm.js";
import { loadSpecs } from "../../src/services/exerciseSpecs.js";
import { databricksExportQueue, drizzleExportStatusStore } from "../../src/services/exportQueue.js";
import { RestNoteWriter } from "../../src/services/restNote.js";
import { createTestDb, setup } from "../helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLIPS_DIR = path.resolve(here, "../../../mobile/src/engine/__fixtures__");
const SPECS_DIR = path.resolve(here, "../../../../specs/exercises");

/** Every committed clip, sorted by name (same set the mobile engine tests use). */
export function loadClips(dir = CLIPS_DIR): Clip[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Clip)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Stage 2 + 3: rules and set record ----

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Engine output + AI-07 rules -> AI-08's set record, the payload POST /sessions/:id/sets takes.
 * Wired the way the phone wires it: every pose goes to the engine and the recorder, and every
 * engine event to the rules and the recorder.
 */
export function toSetPayload(clip: Clip): SetRecord {
  const spec = getSpec(clip.exercise)!;
  const engine = createFormEngine(spec, { imageAspect: clip.image.width / clip.image.height });
  const rules = createSetRules(spec);
  const recorder = createSetRecorder(spec, { setIndex: 0 });
  const dispatch = (events: EngineEvent[]) => {
    for (const event of events) {
      recorder.event(event);
      rules.handle(event);
    }
  };
  for (const frame of clip.frames) {
    if (isAbsentFrame(frame)) dispatch(engine.pushAbsent(frame.timestamp_ms).events);
    else {
      recorder.pose(frame);
      dispatch(engine.push(frame).events);
    }
  }
  if (!rules.summary()) dispatch(engine.endSet(clip.frames.at(-1)!.timestamp_ms).events);
  return recorder.finish(rules.summary()!);
}

/** The clip's pose source, as the session's inference mode. */
function inferenceMode(clip: Clip): InferenceMode {
  const pose = clip.frames.find((f): f is PoseResult => !isAbsentFrame(f));
  return pose?.source ?? "coreml";
}

// ---- Stage 4: API with faked network ----

const PSEUDONYM_SECRET = "replay-pseudonym-secret-0123456789";
const DATABRICKS_HOST = "https://dbc.replay.test";
const STARTED_AT = "2026-10-10T15:00:00.000Z";
const FINISHED_AT = "2026-10-10T15:05:00.000Z";
const LLM_SUGGESTION = "A steady pace on the way down tends to keep every rep feeling controlled.";

export type Upload = { path: string; body: Buffer };

/** Answers every outbound request the API makes; anything unexpected fails the replay. */
function fakeNetwork() {
  const uploads: Upload[] = [];
  const scored: unknown[][] = [];
  const llmCalls: unknown[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

    if (url === `${DATABRICKS_HOST}/oidc/v1/token`) return json({ access_token: "replay", expires_in: 3600 });
    if (url.startsWith(`${DATABRICKS_HOST}/serving-endpoints/`)) {
      const records = JSON.parse(init!.body as string).dataframe_records as unknown[];
      scored.push(records);
      return json({ predictions: records.map(() => ({ quality: 0.8, label: "clean" })) });
    }
    if (url.startsWith(`${DATABRICKS_HOST}/api/2.0/fs/files/`) && init?.method === "PUT") {
      const filePath = decodeURI(new URL(url).pathname.slice("/api/2.0/fs/files".length));
      uploads.push({ path: filePath, body: Buffer.from(init.body as Uint8Array) });
      return new Response(null, { status: 204 });
    }
    // Hugging Face: provider lookup for the model, then the chat completion.
    if (url.startsWith("https://huggingface.co/api/models/")) {
      return json({
        _id: "replay",
        id: "openai/gpt-oss-120b",
        inferenceProviderMapping: {
          cerebras: { status: "live", providerId: "gpt-oss-120b", task: "conversational" },
        },
      });
    }
    if (url.startsWith("https://router.huggingface.co/") && url.endsWith("/chat/completions")) {
      llmCalls.push(JSON.parse(init!.body as string));
      return json({
        id: "replay",
        object: "chat.completion",
        created: 0,
        model: "gpt-oss-120b",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify({ suggestion: LLM_SUGGESTION }) },
          },
        ],
      });
    }
    throw new Error(`replay: unexpected request ${init?.method ?? "GET"} ${url}`);
  }) as typeof fetch;
  return { fakeFetch, uploads, scored, llmCalls };
}

export async function createReplayApi() {
  const net = fakeNetwork();
  const silent = pino({ level: "silent" });
  const uploadConfig: UploadConfig = {
    host: DATABRICKS_HOST,
    clientId: "replay",
    clientSecret: "replay",
    scopes: "all-apis",
    volumePath: "/Volumes/steadyforum/raw/sessions",
    pseudonymSecret: PSEUDONYM_SECRET,
    maxAttempts: 1,
    baseDelayMs: 1,
  };
  const scorer = new DatabricksScorer(
    {
      host: DATABRICKS_HOST,
      clientId: "replay",
      clientSecret: "replay",
      scopes: "all-apis",
      endpoint: "form-quality",
      timeoutMs: 1200,
    },
    net.fakeFetch,
    silent,
  );
  const llm = new HfLlm(
    {
      token: "hf_replay",
      chain: [{ model: "openai/gpt-oss-120b", provider: "cerebras" }],
      attemptsPerPair: 1,
      defaultTimeoutMs: 1000,
    },
    new InferenceClient("hf_replay", { fetch: net.fakeFetch }),
  );

  const { db, close } = await createTestDb();
  const uploader = new DatabricksUploader(uploadConfig, drizzleExportStatusStore(db), net.fakeFetch, {
    error: () => {},
  });
  const t = await setup({
    db,
    close,
    exportQueue: databricksExportQueue(uploader, silent),
    rest: { scorer, notes: new RestNoteWriter(llm) },
    pseudonymSecret: PSEUDONYM_SECRET,
  });
  await loadSpecs(t.db, SPECS_DIR);
  return { ...t, net };
}

export type ReplayApi = Awaited<ReturnType<typeof createReplayApi>>;

async function waitForExport(api: ReplayApi, sessionId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const [s] = await api.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (s?.exportStatus === "exported" || s?.exportStatus === "failed") return s.exportStatus;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`replay: session ${sessionId} never finished exporting`);
}

// ---- Golden summary ----

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Replaces ids and wall-clock times so the summary only changes when behaviour does. The
 * replay's own fixed start and finish times are kept; latencies are dropped.
 */
function stable(value: unknown, ids: Map<string, string>): unknown {
  if (value instanceof Date) value = value.toISOString();
  if (typeof value === "string") {
    if (ISO_TIME.test(value)) {
      const iso = new Date(value).toISOString();
      return iso === STARTED_AT || iso === FINISHED_AT ? iso : "<time>";
    }
    return value.replace(UUID, (m) => {
      if (!ids.has(m)) ids.set(m, `<id ${ids.size + 1}>`);
      return ids.get(m)!;
    });
  }
  if (Array.isArray(value)) return value.map((v) => stable(v, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "timings_ms" || k === "latency_ms" || k === "latencyMs") continue;
      out[k] = stable(v, ids);
    }
    return out;
  }
  return value;
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 16);

/** Runs one clip end to end and returns everything the golden file pins. */
export async function replayClip(api: ReplayApi, clip: Clip) {
  const run = runClip(clip);
  const payload = toSetPayload(clip);

  const user = `replay-${clip.name}`;
  const client = await api.as(user);
  const session = await client.post("/sessions", {
    started_at: STARTED_AT,
    device: "replay",
    inference_mode: inferenceMode(clip),
  });
  if (session.status !== 201)
    throw new Error(`POST /sessions ${session.status}: ${JSON.stringify(session.body)}`);
  const sessionId = session.body.id as string;

  const llmBefore = api.net.llmCalls.length;
  const uploadsBefore = api.net.uploads.length;
  const set = await client.post(`/sessions/${sessionId}/sets`, payload);
  if (set.status !== 201) throw new Error(`POST /sets ${set.status}: ${JSON.stringify(set.body)}`);
  const finish = await client.post(`/sessions/${sessionId}/finish`, { finished_at: FINISHED_AT });
  if (finish.status !== 200) throw new Error(`POST /finish ${finish.status}: ${JSON.stringify(finish.body)}`);
  const exportStatus = await waitForExport(api, sessionId);

  const [sessionRow] = await api.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
  const setRows = await api.db.select().from(schema.sets).where(eq(schema.sets.sessionId, sessionId));
  const setIds = setRows.map((s) => s.id);
  const repRows = setIds.length
    ? await api.db.select().from(schema.reps).where(inArray(schema.reps.setId, setIds))
    : [];
  const repIds = repRows.map((r) => r.id);
  const flagRows = repIds.length
    ? await api.db.select().from(schema.formFlags).where(inArray(schema.formFlags.repId, repIds))
    : [];
  const medalRows = await api.db.select().from(schema.medals).where(eq(schema.medals.sessionId, sessionId));

  const uploads = api.net.uploads.slice(uploadsBefore).map((u) => {
    if (u.path.endsWith(".ndjson.gz")) {
      const text = gunzipSync(u.body).toString("utf8");
      const lines = text
        .trim()
        .split("\n")
        .map(
          (l) =>
            JSON.parse(l) as { set_index: number; exercise_id: string; fps: number; frames: JointFrame[] },
        );
      return {
        path: u.path,
        sets: lines.map((l) => ({
          set_index: l.set_index,
          exercise_id: l.exercise_id,
          fps: l.fps,
          frame_count: l.frames.length,
          first_t_ms: l.frames[0]?.t_ms ?? null,
          last_t_ms: l.frames.at(-1)?.t_ms ?? null,
          frames_sha256: sha256(JSON.stringify(l.frames)),
        })),
      };
    }
    return { path: u.path, metadata: JSON.parse(u.body.toString("utf8")) };
  });

  const ids = new Map<string, string>();
  return {
    clip: { name: clip.name, exercise: clip.exercise, source: clip.source, frames: clip.frames.length },
    engine: {
      reps: run.counted.length,
      partials: run.partials,
      set_end: run.setEnd?.reason ?? null,
      per_rep: run.reps.map((r) => ({
        index: r.index,
        side: r.side,
        extreme_deg: r1(r.extreme),
        durations_ms: {
          outbound: Math.round(r.durations.outbound),
          peak: Math.round(r.durations.peak),
          return: Math.round(r.durations.return),
          rep: Math.round(r.durations.rep),
        },
      })),
    },
    set_payload: {
      ...payload,
      frames: { count: payload.frames.length, sha256: sha256(JSON.stringify(payload.frames)) },
    },
    api: stable(
      {
        set_response: set.body,
        finish_response: finish.body,
        llm_called: api.net.llmCalls.length > llmBefore,
        rows: {
          session: sessionRow,
          sets: setRows,
          reps: repRows.sort((a, b) => a.position - b.position),
          form_flags: flagRows,
          medals: medalRows,
        },
      },
      ids,
    ),
    upload: { export_status: exportStatus, files: stable(uploads, ids) },
  };
}
