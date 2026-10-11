// BE-11: ask the community for advice; Spotter adds a suggested first answer (Architecture §10.2).
//
//   POST /advice { body }  -> 201 { post, outcome, reply, reason? }
//     outcome "ai"          reply is the AI-suggested comment (ai_suggested: true, with its sources)
//     outcome "fixed_pain"  the question mentions pain or an acute sign: reply is the fixed
//                           "see a doctor or physio" comment, and the model never sees the question
//     outcome "none"        no suggestion (nothing to cite, model unavailable or answer rejected);
//                           community answers carry the thread
//
// The question is moderated like a post (Llama Guard plus the threats/harassment check) because
// other members see it in the feed. Answers to it use POST /posts/:id/comments as usual.
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { parse, send, userId } from "../http.js";
import { askAdvice, type AdviceDeps } from "../services/adviceThread.js";
import type { Moderator } from "../services/moderation.js";
import { moderate } from "./social.js";

export const adviceInput = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

export function adviceRouter(db: Db, moderator: Moderator, deps: AdviceDeps): Router {
  const router = Router();

  router.post("/advice", async (req, res) => {
    const me = userId(req);
    const { body } = parse(adviceInput, req.body);
    await moderate(db, moderator, req, body, { kind: "post", checkAs: "advice" });
    send(res, await askAdvice(db, deps, me, body), 201);
  });

  return router;
}
