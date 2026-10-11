# Databricks notebook source
# MAGIC %md
# MAGIC # Synthetic sessions for the demo (CONN-14, Architecture §11.2, §17)
# MAGIC
# MAGIC Writes sessions to the sessions Volume **exactly as the API uploads them** (CONN-02,
# MAGIC `apps/api/src/integrations/databricks/upload.ts`): `meta/<date>/<id>.json` plus
# MAGIC `joints/<date>/<id>.ndjson.gz` with per-frame joints, so the whole pipeline runs on them,
# MAGIC including the joint angles behind `gold_rom_trend`.
# MAGIC
# MAGIC - **Users** are the demo seed's lifters (`demo-user-01` … in `apps/api/scripts/seed-demo.ts`),
# MAGIC   under their real pseudonyms (HMAC with the API's `STEADYFORUM_PSEUDONYM_SECRET`, stored here as
# MAGIC   the secret `steadyforum/pseudonym_secret`), so the insight sync maps them to the seeded accounts.
# MAGIC - **Recovery users** follow the §17 story: the injured side sits around 70° for the first two
# MAGIC   weeks of their rehab plan, then gains about 6° a week for three weeks (+18°), ending within
# MAGIC   5° of the healthy side.
# MAGIC - Session ids are deterministic, so re-running overwrites instead of duplicating.
# MAGIC
# MAGIC Run it, then run the `steadyforum_sessions` pipeline and the insight sync.

# COMMAND ----------

import gzip
import hashlib
import hmac
import json
import math
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


def load_seed_user_ids(path: str, users: int, presenter_user_id: str = "") -> list[str]:
    """Shared DB-10 manifest; presenter replaces the first account in both seeds."""
    ids = json.loads(Path(path).read_text())
    if not isinstance(ids, list) or not ids or not all(isinstance(u, str) and u for u in ids):
        raise ValueError("Invalid demo user manifest")
    if len(set(ids)) != len(ids) or not 1 <= users <= len(ids):
        raise ValueError("Invalid demo user count or duplicate ids")
    ids = ids[:users]
    if presenter_user_id:
        ids[0] = presenter_user_id
    if len(set(ids)) != len(ids):
        raise ValueError("Presenter id duplicates another demo user")
    return ids


FPS = 10
SCHEMA_VERSION = 1
NAMESPACE = uuid.UUID("5b8f1c1e-4f3a-4e0b-9a51-7d0c2f3b9e11")  # deterministic session ids

# Primary angle and typical range per exercise (specs/exercises/*.json).
EXERCISES = {
    "squat": {"angle": "knee", "range": 92.0, "kg": (20, 60)},
    "lunge": {"angle": "knee", "range": 88.0, "kg": (0, 20)},
    "push_up": {"angle": "elbow", "range": 85.0, "kg": (0, 0)},
    "bicep_curl": {"angle": "elbow", "range": 115.0, "kg": (6, 16)},
    "shoulder_press": {"angle": "elbow", "range": 80.0, "kg": (6, 20)},
}
INJURY_ANGLE = {"knee": "knee", "shoulder": "elbow", "elbow": "elbow", "wrist": "elbow"}


def pseudonymize(user_id: str, secret: str) -> str:
    """Same as pseudonymize() in upload.ts: HMAC-SHA256, first 32 hex chars."""
    return hmac.new(secret.encode(), user_id.encode(), hashlib.sha256).hexdigest()[:32]


def recovery_offset(week: int) -> float:
    """Degrees below the healthy side, by week of the rehab plan (0-based): flat, then +6°/week."""
    if week < 2:
        return 22.0
    return max(4.0, 22.0 - 6.0 * (week - 1))  # weeks 2, 3, 4 -> 16, 10, 4 below; then 4


# ---- Joints ----

def skeleton(knee_l: float, knee_r: float, elbow_l: float, elbow_r: float) -> list[float]:
    """17 COCO joints (x, y, c) for the given knee and elbow angles, in normalised image space."""
    kp = [0.0] * 51

    def put(j, x, y, c=0.9):
        kp[3 * j:3 * j + 3] = [round(x, 4), round(y, 4), c]

    for side, x0 in ((0, 0.45), (1, 0.55)):  # 0 = left, 1 = right
        knee_deg, elbow_deg = (knee_l, elbow_l) if side == 0 else (knee_r, elbow_r)
        phi = math.radians(180.0 - knee_deg)
        ankle, knee = (x0, 0.90), (x0, 0.72)
        hip = (knee[0] + 0.18 * math.sin(phi), knee[1] - 0.18 * math.cos(phi))
        shoulder = (hip[0], hip[1] - 0.30)
        elbow = (shoulder[0], shoulder[1] + 0.15)
        a = math.radians(elbow_deg)
        wrist = (elbow[0] + 0.14 * math.sin(a), elbow[1] - 0.14 * math.cos(a))
        put(15 + side, *ankle), put(13 + side, *knee), put(11 + side, *hip)
        put(5 + side, *shoulder), put(7 + side, *elbow), put(9 + side, *wrist)
    for j in range(5):  # face
        put(j, 0.5, max(0.02, kp[16] - 0.12))
    return kp


def rep_frames(start_ms: int, duration_ms: int, angle: str, range_l: float, range_r: float):
    frames = []
    n = max(8, int(duration_ms / 1000 * FPS))
    for f in range(n + 1):
        depth = math.sin(math.pi * f / n)  # 0 -> 1 -> 0 over the rep
        knee_l = 170 - range_l * depth if angle == "knee" else 170
        knee_r = 170 - range_r * depth if angle == "knee" else 170
        elbow_l = 170 - range_l * depth if angle == "elbow" else 170
        elbow_r = 170 - range_r * depth if angle == "elbow" else 170
        frames.append({"t_ms": start_ms + int(duration_ms * f / n), "kp": skeleton(knee_l, knee_r, elbow_l, elbow_r)})
    return frames


# ---- Sessions ----

def generate(user_ids: list[str], weeks: int, secret: str, recovery: dict, now: datetime, seed: int = 7):
    """Yields (date, session_id, meta, joints_lines) in upload.ts's format."""
    rng = random.Random(seed)
    # Weeks start on Monday, like the pipeline's weeks (date_trunc("week")), so each generated week
    # lands in one gold_rom_trend week. The rehab plan starts on the first Monday.
    first = (now - timedelta(weeks=weeks)).replace(hour=0, minute=0, second=0, microsecond=0)
    start = first - timedelta(days=first.weekday())
    for user_id in user_ids:
        pseudonym = pseudonymize(user_id, secret)
        injury = recovery.get(user_id)  # (body_part, side) or None
        level = rng.choice(["beginner", "beginner", "intermediate", "advanced"])
        if injury:
            part = injury[0]
            exercises = ["squat", "lunge"] if INJURY_ANGLE.get(part) == "knee" else ["shoulder_press", "push_up"]
        else:
            exercises = rng.sample(sorted(EXERCISES), 3)
        per_week = rng.randint(2, 4)
        for week in range(weeks):
            for s in range(per_week):
                day = start + timedelta(days=7 * week + rng.randint(0, 6), hours=rng.choice([7, 12, 18]))
                if day > now:
                    continue
                session_id = str(uuid.uuid5(NAMESPACE, f"{user_id}/{week}/{s}"))
                sets_meta, joints_lines = [], []
                for set_index, exercise in enumerate(rng.sample(exercises, min(2, len(exercises)))):
                    spec = EXERCISES[exercise]
                    healthy = spec["range"] + rng.uniform(-3, 3)
                    t, reps, frames = 0, [], []
                    for rep_index in range(rng.randint(6, 10)):
                        ranges = {"left": healthy + rng.gauss(0, 2), "right": healthy + rng.gauss(0, 2)}
                        if injury and INJURY_ANGLE.get(injury[0]) == spec["angle"] and injury[1] in ranges:
                            ranges[injury[1]] -= recovery_offset(week) + rng.gauss(0, 1.5)
                        duration = int(rng.uniform(2000, 3000))
                        frames += rep_frames(t, duration, spec["angle"], ranges["left"], ranges["right"])
                        flagged = injury is not None and rng.random() < 0.4 - 0.05 * week
                        reps.append({
                            "rep_index": rep_index, "start_ms": t, "end_ms": t + duration,
                            "tempo_ms": duration, "range_deg": round(min(ranges.values()), 1),
                            "quality": round(0.55 if flagged else rng.uniform(0.8, 0.98), 2),
                            "lowering_ms": None, "rising_ms": None,
                            "flags": [{"rule_id": "depth", "severity": "form", "rep_index": rep_index}] if flagged else [],
                        })
                        t += duration + 600
                    lo, hi = spec["kg"]
                    sets_meta.append({
                        "set_index": set_index, "exercise_id": exercise,
                        "weight_kg": round(lo + (hi - lo) * (0.4 + 0.1 * week), 1) if hi else None,
                        "medal": None, "end_reason": None, "partial_reps": None,
                        "frame_count": len(frames), "reps": reps,
                    })
                    joints_lines.append(json.dumps({"session_id": session_id, "set_index": set_index,
                                                     "exercise_id": exercise, "fps": FPS, "frames": frames}))
                date = day.date().isoformat()
                meta = {
                    "schema_version": SCHEMA_VERSION, "session_id": session_id, "user_id": pseudonym,
                    "started_at": day.isoformat(), "finished_at": (day + timedelta(minutes=35)).isoformat(),
                    "device": "synthetic", "inference_mode": "coreml", "medal": None, "form_score": None,
                    "experience_level": level,
                    "injury_groups": [f"{injury[0]}:{injury[1]}"] if injury else [],
                    "rehab_start_on": start.date().isoformat() if injury else None,
                    "joints_path": f"joints/{date}/{session_id}.ndjson.gz",
                    "exported_at": now.isoformat(), "sets": sets_meta,
                }
                yield date, session_id, meta, joints_lines


def write_sessions(sessions, volume: str) -> int:
    import os

    n = 0
    for date, session_id, meta, joints_lines in sessions:
        os.makedirs(f"{volume}/joints/{date}", exist_ok=True)
        os.makedirs(f"{volume}/meta/{date}", exist_ok=True)
        with open(f"{volume}/joints/{date}/{session_id}.ndjson.gz", "wb") as f:  # joints first, like upload.ts
            f.write(gzip.compress(("\n".join(joints_lines) + "\n").encode()))
        with open(f"{volume}/meta/{date}/{session_id}.json", "w") as f:
            json.dump(meta, f)
        n += 1
    return n


# COMMAND ----------

# MAGIC %md ## Run

# COMMAND ----------

dbutils.widgets.text("seed_user_ids_path", "", "repo data/demo-user-ids.json path (required)")
dbutils.widgets.text("presenter_user_id", "", "same as DEMO_PRESENTER_USER_ID")
dbutils.widgets.text("users", "30", "demo users (demo-user-01 ...)")
dbutils.widgets.text("weeks", "6", "weeks of history")
dbutils.widgets.text("recovery", "demo-user-01:knee:left,demo-user-04:shoulder:right,demo-user-07:knee:right",
                     "recovery users (user:body_part:side, comma-separated)")
dbutils.widgets.text("volume", "/Volumes/steadyforum/raw/sessions", "sessions Volume")

recovery = {
    u: (part, side)
    for u, part, side in (r.split(":") for r in dbutils.widgets.get("recovery").split(",") if r.strip())
}
presenter = dbutils.widgets.get("presenter_user_id")
if presenter and "demo-user-01" in recovery:
    recovery[presenter] = recovery.pop("demo-user-01")
written = write_sessions(
    generate(
        user_ids=load_seed_user_ids(dbutils.widgets.get("seed_user_ids_path"), int(dbutils.widgets.get("users")), dbutils.widgets.get("presenter_user_id")),
        weeks=int(dbutils.widgets.get("weeks")),
        secret=dbutils.secrets.get(scope="steadyforum", key="pseudonym_secret"),
        recovery=recovery,
        now=datetime.now(timezone.utc),
    ),
    dbutils.widgets.get("volume"),
)
print(f"wrote {written} sessions; now run the steadyforum_sessions pipeline")
