// BE-12: gym-buddy matching (§12).
//   filter  same gym or within 5 km, experience within one level, not blocked, no existing match
//   rank    by goal similarity (pgvector cosine on profile embeddings, CONN-08)
//   score   0.4 goals + 0.3 schedule + 0.2 level + 0.1 streak
// Until CONN-08 writes embeddings, goal similarity falls back to overlap of the goal tags.
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";

const { profiles, users, blocks, buddyMatches, sessions } = schema;

export const WEIGHTS = { goals: 0.4, schedule: 0.3, level: 0.2, streak: 0.1 } as const;
export const MAX_DISTANCE_KM = 5;
export const SUGGESTION_COUNT = 10;
const CANDIDATE_POOL = 50;

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
type Level = (typeof LEVELS)[number];

export interface MatchProfile {
  userId: string;
  handle: string;
  displayName: string | null;
  experienceLevel: Level;
  gymPlaceId: string | null;
  gymName: string | null;
  schedule: string[];
  goals: string[];
  weeklySessions: number; // average over the last 4 weeks
}

export interface MatchCandidate extends MatchProfile {
  distanceKm: number | null;
  goalSimilarity: number | null; // 1 - cosine distance, when both have embeddings
}

export interface ScoredMatch {
  score: number;
  parts: { goals: number; schedule: number; level: number; streak: number };
  reasons: string[];
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  for (const x of sa) if (sb.has(x)) shared++;
  return shared / (sa.size + sb.size - shared);
}

const DAY_NAMES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
const PART_NAMES: Record<string, string> = { am: "mornings", pm: "afternoons", eve: "evenings" };

export function describeSlot(slot: string): string {
  const [day, part] = slot.split("_");
  return `${DAY_NAMES[day ?? ""] ?? day} ${PART_NAMES[part ?? ""] ?? part}`;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function scorePair(me: MatchProfile, them: MatchCandidate): ScoredMatch {
  const sharedGoals = me.goals.filter((g) =>
    them.goals.map((x) => x.toLowerCase()).includes(g.toLowerCase()),
  );
  const goals = them.goalSimilarity !== null ? clamp01(them.goalSimilarity) : jaccard(me.goals, them.goals);
  const sharedSlots = me.schedule.filter((s) => them.schedule.includes(s));
  const schedule = jaccard(me.schedule, them.schedule);
  const levelGap = Math.abs(LEVELS.indexOf(me.experienceLevel) - LEVELS.indexOf(them.experienceLevel));
  const level = 1 - levelGap / 2;
  const maxRhythm = Math.max(me.weeklySessions, them.weeklySessions);
  const streak = maxRhythm === 0 ? 0 : 1 - Math.abs(me.weeklySessions - them.weeklySessions) / maxRhythm;

  const parts = { goals, schedule, level, streak };
  const score =
    WEIGHTS.goals * goals + WEIGHTS.schedule * schedule + WEIGHTS.level * level + WEIGHTS.streak * streak;

  const reasons: string[] = [];
  if (me.gymPlaceId && me.gymPlaceId === them.gymPlaceId) {
    reasons.push(them.gymName ? `Same gym: ${them.gymName}` : "Same gym");
  } else if (them.distanceKm !== null) {
    reasons.push(`Gyms ${them.distanceKm.toFixed(1)} km apart`);
  }
  if (levelGap === 0) {
    reasons.push(me.experienceLevel === "beginner" ? "Both beginners" : `Both ${me.experienceLevel} lifters`);
  }
  if (sharedSlots.length) {
    reasons.push(`Both train ${sharedSlots.slice(0, 2).map(describeSlot).join(" and ")}`);
  }
  if (sharedGoals.length) reasons.push(`Shared goals: ${sharedGoals.slice(0, 3).join(", ")}`);
  else if (them.goalSimilarity !== null && them.goalSimilarity >= 0.75) reasons.push("Similar goals");
  if (streak >= 0.7 && maxRhythm > 0) reasons.push("Similar training rhythm");

  return { score: Math.round(score * 1000) / 1000, parts, reasons };
}

// ---- Queries ----

function weeklySessionsSql(userIdCol: SQL | typeof profiles.userId): SQL<number> {
  return sql<number>`(
    select count(*)::float / 4 from ${sessions}
    where ${sessions.userId} = ${userIdCol}
      and ${sessions.finishedAt} >= now() - interval '28 days')`;
}

function notBlockedSql(me: string, other: SQL | typeof profiles.userId): SQL {
  return sql`not exists (
    select 1 from ${blocks}
    where (${blocks.blockerId} = ${me} and ${blocks.blockedId} = ${other})
       or (${blocks.blockerId} = ${other} and ${blocks.blockedId} = ${me}))`;
}

const profileColumns = {
  userId: profiles.userId,
  handle: users.handle,
  displayName: profiles.displayName,
  experienceLevel: profiles.experienceLevel,
  gymPlaceId: profiles.gymPlaceId,
  gymName: profiles.gymName,
  schedule: profiles.schedule,
  goals: profiles.goals,
};

export async function loadMatchProfile(db: Db, userId: string) {
  const [row] = await db
    .select({
      ...profileColumns,
      gymLat: profiles.gymLat,
      gymLng: profiles.gymLng,
      embedding: profiles.embedding,
      weeklySessions: weeklySessionsSql(profiles.userId),
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId));
  return row ? { ...row, weeklySessions: Number(row.weeklySessions) } : null;
}

function distanceKmSql(lat: number, lng: number): SQL<number> {
  return sql<number>`(2 * 6371 * asin(sqrt(
    power(sin(radians(${profiles.gymLat} - ${lat}) / 2), 2) +
    cos(radians(${lat})) * cos(radians(${profiles.gymLat})) *
    power(sin(radians(${profiles.gymLng} - ${lng}) / 2), 2))))`;
}

export async function suggestBuddies(db: Db, userId: string) {
  const me = await loadMatchProfile(db, userId);
  if (!me) return { suggestions: [], hint: "Finish your profile to get buddy suggestions" };
  const hasCoords = me.gymLat !== null && me.gymLng !== null;
  if (!me.gymPlaceId && !hasCoords) {
    return { suggestions: [], hint: "Add your gym to your profile to find buddies near you" };
  }

  const distance = hasCoords ? distanceKmSql(me.gymLat!, me.gymLng!) : sql<number>`null::float`;
  const levelIndex = LEVELS.indexOf(me.experienceLevel);
  const nearbyLevels = LEVELS.filter((_, i) => Math.abs(i - levelIndex) <= 1);
  const embeddingLiteral = me.embedding ? `[${me.embedding.join(",")}]` : null;
  const goalSimilarity = embeddingLiteral
    ? sql<number | null>`1 - (${profiles.embedding} <=> ${embeddingLiteral}::vector)`
    : sql<number | null>`null::float`;

  const nearby: SQL[] = [];
  if (me.gymPlaceId) nearby.push(sql`${profiles.gymPlaceId} = ${me.gymPlaceId}`);
  if (hasCoords) {
    nearby.push(
      sql`(${profiles.gymLat} is not null and ${profiles.gymLng} is not null and ${distance} <= ${MAX_DISTANCE_KM})`,
    );
  }

  const rows = await db
    .select({
      ...profileColumns,
      distanceKm: distance,
      goalSimilarity,
      weeklySessions: weeklySessionsSql(profiles.userId),
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        ne(profiles.userId, userId),
        inArray(profiles.experienceLevel, nearbyLevels),
        sql`(${sql.join(nearby, sql` or `)})`,
        notBlockedSql(userId, profiles.userId),
        sql`not exists (
          select 1 from ${buddyMatches}
          where least(${buddyMatches.aId}, ${buddyMatches.bId}) = least(${userId}, ${profiles.userId})
            and greatest(${buddyMatches.aId}, ${buddyMatches.bId}) = greatest(${userId}, ${profiles.userId}))`,
      ),
    )
    .orderBy(embeddingLiteral ? sql`${goalSimilarity} desc nulls last` : sql`${profiles.updatedAt} desc`)
    .limit(CANDIDATE_POOL);

  const suggestions = rows
    .map((r) => {
      const candidate: MatchCandidate = {
        ...r,
        distanceKm: r.distanceKm === null ? null : Number(r.distanceKm),
        goalSimilarity: r.goalSimilarity === null ? null : Number(r.goalSimilarity),
        weeklySessions: Number(r.weeklySessions),
      };
      const scored = scorePair(me, candidate);
      return {
        user: {
          id: r.userId,
          handle: r.handle,
          displayName: r.displayName,
          experienceLevel: r.experienceLevel,
          gymName: r.gymName,
        },
        ...scored,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SUGGESTION_COUNT);

  return { suggestions, hint: null };
}

export async function scoreForPair(db: Db, me: string, otherId: string): Promise<ScoredMatch | null> {
  const [mine, theirs] = await Promise.all([loadMatchProfile(db, me), loadMatchProfile(db, otherId)]);
  if (!mine || !theirs) return null;
  const goalSimilarity =
    mine.embedding && theirs.embedding ? cosineSimilarity(mine.embedding, theirs.embedding) : null;
  return scorePair(mine, { ...theirs, distanceKm: null, goalSimilarity });
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(blocks)
    .where(
      sql`(${blocks.blockerId} = ${a} and ${blocks.blockedId} = ${b}) or (${blocks.blockerId} = ${b} and ${blocks.blockedId} = ${a})`,
    )
    .limit(1);
  return Boolean(row);
}
