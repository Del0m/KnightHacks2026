// Blocking is mutual (§12): if either user blocked the other, they don't see each other's posts
// and aren't suggested or requested as buddies. The feed, buddy suggestions and buddy requests all
// use these, so the rule lives in one place.
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";

const { blocks } = schema;

type UserRef = string | SQLWrapper; // a user id, or a column holding one

function eitherDirection(a: UserRef, b: UserRef): SQL {
  return sql`((${blocks.blockerId} = ${a} and ${blocks.blockedId} = ${b})
    or (${blocks.blockerId} = ${b} and ${blocks.blockedId} = ${a}))`;
}

/** SQL condition: neither user has blocked the other. */
export function notBlocked(a: UserRef, b: UserRef): SQL {
  return sql`not exists (select 1 from ${blocks} where ${eitherDirection(a, b)})`;
}

export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(blocks)
    .where(eitherDirection(a, b))
    .limit(1);
  return Boolean(row);
}
