// BE-12: GET /buddies/suggestions, POST /buddies/:id/request, accept and decline.
import { and, desc, eq, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, conflict, isUniqueViolation, notFound, parse, send, userId } from "../http.js";
import { isBlockedEitherWay, notBlocked } from "../services/blocks.js";
import { scoreForPair, suggestBuddies } from "../services/matching.js";

const { buddyMatches, users } = schema;
const otherId = z.string().min(1).max(200);

export function buddiesRouter(db: Db): Router {
  const router = Router();

  router.get("/buddies/suggestions", async (req, res) => {
    send(res, await suggestBuddies(db, userId(req)));
  });

  // My buddies and pending requests in both directions.
  router.get("/buddies", async (req, res) => {
    const me = userId(req);
    const otherUser = sql<string>`case when ${buddyMatches.aId} = ${me} then ${buddyMatches.bId} else ${buddyMatches.aId} end`;
    const rows = await db
      .select({
        userId: otherUser,
        handle: users.handle,
        status: buddyMatches.status,
        direction: sql<
          "outgoing" | "incoming"
        >`case when ${buddyMatches.aId} = ${me} then 'outgoing' else 'incoming' end`,
        score: buddyMatches.score,
        reasons: buddyMatches.reasons,
        updatedAt: buddyMatches.updatedAt,
      })
      .from(buddyMatches)
      .innerJoin(users, eq(users.id, otherUser))
      .where(
        and(
          or(eq(buddyMatches.aId, me), eq(buddyMatches.bId, me)),
          sql`${buddyMatches.status} <> 'declined'`,
          notBlocked(me, otherUser),
        ),
      )
      .orderBy(desc(buddyMatches.updatedAt));
    send(res, rows);
  });

  router.post("/buddies/:id/request", async (req, res) => {
    const me = userId(req);
    const target = parse(otherId, req.params.id);
    if (target === me) throw badRequest("You can't buddy up with yourself");
    if (await isBlockedEitherWay(db, me, target)) throw notFound("User");
    const scored = await scoreForPair(db, me, target);
    if (!scored) throw notFound("User");
    try {
      const [row] = await db
        .insert(buddyMatches)
        .values({ aId: me, bId: target, score: scored.score, reasons: scored.reasons })
        .returning();
      send(res, row, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("You already have a buddy request with this person");
      throw err;
    }
  });

  for (const action of ["accept", "decline"] as const) {
    router.post(`/buddies/:id/${action}`, async (req, res) => {
      const me = userId(req);
      const requester = parse(otherId, req.params.id);
      if (await isBlockedEitherWay(db, me, requester)) throw notFound("Buddy request");
      const [row] = await db
        .update(buddyMatches)
        .set({ status: action === "accept" ? "accepted" : "declined", updatedAt: new Date() })
        .where(
          and(
            eq(buddyMatches.aId, requester),
            eq(buddyMatches.bId, me),
            eq(buddyMatches.status, "requested"),
          ),
        )
        .returning();
      if (!row) throw notFound("Buddy request");
      send(res, row);
    });
  }

  return router;
}
