// npm run dev:smoke: walk a running API (npm run dev) through a real workout with your Neon Auth
// token, the same calls the app makes. Needs TOKEN from `npm run dev:token`.
// Writes to whatever branch DATABASE_URL points at: use your dev branch.
import type { Rep, SetRecord } from "../../../specs/set-record/types.js";
const api = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const token = process.env.TOKEN;
if (!token) {
  console.error("TOKEN is not set. Run `npm run dev:token` and paste the line it prints.");
  process.exit(1);
}

let failures = 0;
async function call(method: string, path: string, body?: unknown, expect = [200, 201, 204]) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const ok = expect.includes(res.status);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${method} ${path} -> ${res.status}`);
  if (!ok) console.log("      ", text.slice(0, 300));
  return json;
}

const cleanRep: Rep = {
  rep_index: 0,
  start_ms: null,
  end_ms: null,
  lowering_ms: null,
  rising_ms: null,
  tempo_ms: 2100,
  range_deg: 94,
  quality: null,
  flags: [],
};
const kneesIn: Rep = {
  ...cleanRep,
  tempo_ms: 1700,
  range_deg: 101,
  flags: [{ rule_id: "knee_tracking", severity: "form", rep_index: 0 }],
};

function setRecord(set_index: number, exercise_id: string, weight_kg: number | null, reps: Rep[]): SetRecord {
  return {
    schema_version: 1,
    set_index,
    exercise_id,
    weight_kg,
    end_reason: "manual",
    partial_reps: 0,
    fps: null,
    frames: [],
    reps: reps.map((rep, rep_index) => ({
      ...rep,
      rep_index,
      flags: rep.flags.map((flag) => ({ ...flag, rep_index })),
    })),
  };
}

const profile = await call("PUT", "/me/profile", {
  gym_place_id: "demo-gym-ucf-rwc", // same gym as half the seeded lifters
  gym_name: "UCF Recreation & Wellness Center",
  gym_lat: 28.6024,
  gym_lng: -81.2001,
  schedule: ["mon_am", "wed_am", "fri_pm"],
  goals: ["strength", "consistency"],
  auto_post_medals: true,
  auto_post_prs: true,
});
console.log(`      you are @${profile?.handle} (id ${profile?.id})`);

const session = await call("POST", "/sessions", { device: "dev-smoke", inference_mode: "coreml" });
await call(
  "POST",
  `/sessions/${session.id}/sets`,
  setRecord(0, "squat", 40, [cleanRep, cleanRep, kneesIn, cleanRep, cleanRep, cleanRep, cleanRep, cleanRep]),
);
await call("POST", `/sessions/${session.id}/sets`, setRecord(1, "push_up", null, Array(10).fill(cleanRep)));
const finish = await call("POST", `/sessions/${session.id}/finish`);
console.log(
  `      medal: ${finish?.medal} (${finish?.clean_reps}/${finish?.total_reps} clean, ` +
    `baseline ${Math.round((finish?.baseline_share ?? 0) * 100)}%), PRs: ${finish?.personal_records?.length}`,
);
await call("POST", `/sessions/${session.id}/finish`, undefined, [409]); // can't finish twice

const feed = await call("GET", "/feed");
console.log(`      feed: ${feed?.posts?.length} posts, first: "${feed?.posts?.[0]?.body}"`);
if (feed?.posts?.[0]) {
  await call("POST", `/posts/${feed.posts[0].id}/kudos`);
  await call("POST", `/posts/${feed.posts[0].id}/comments`, { body: "Nice work!" });
}

const buddies = await call("GET", "/buddies/suggestions");
for (const s of buddies?.suggestions?.slice(0, 3) ?? []) {
  console.log(`      buddy @${s.user.handle} score ${s.score}: ${s.reasons.join("; ")}`);
}
const progress = await call("GET", "/me/progress");
console.log(
  `      progress: ${progress?.form_trend?.length} sessions, medals ${JSON.stringify(progress?.medals)}`,
);
await call("GET", "/me/insights");
await call("POST", "/sessions", { inference_mode: "telepathy" }, [400]); // validation works

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);

export {}; // top-level await needs this file to be a module
