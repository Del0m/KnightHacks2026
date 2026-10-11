// BE-16 / BE-17: range of motion, the physio report and the back-to-gym milestone (§1.1).
//
//   GET    /me/rom-trend?angle=knee&weeks=12&tz=     weekly peak range, injured vs healthy side
//   GET    /me/physio-report?from=&to=&tz=           the report as JSON (default: plan start to today)
//   POST   /me/physio-report/share?tz=               { from?, to?, expires_in_days? } -> a link
//   GET    /me/physio-report/shares                  links the user made
//   DELETE /me/physio-report/shares/:id              revoke a link
//   GET    /reports/:token                           public: the printable page, 404 unless shared
//   GET    /me/milestones?tz=                        the back-to-gym suggestion, if any
//   POST   /me/milestones/:id/accept                 { share_post? } marks the rehab plan done
//   POST   /me/milestones/:id/dismiss                hides the suggestion for 2 weeks
//
// Nothing is sent anywhere automatically: a report leaves the app only through a link the user
// creates, and every link expires (14 days by default) and can be revoked.
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { badRequest, isoDate, notFound, parse, send, userId } from "../http.js";
import { acceptMilestone, currentMilestone, dismissMilestone } from "../services/milestone.js";
import {
  createShare,
  defaultRange,
  listShares,
  MAX_REPORT_DAYS,
  physioReport,
  REPORT_DISCLAIMER,
  reportHtml,
  resolveShare,
  revokeShare,
  romTrendFor,
  SHARE_DAYS_DEFAULT,
  type ReportRange,
} from "../services/physioReport.js";
import { addDays, daysBetween } from "../services/planHistory.js";
import { localDate } from "../services/rehab.js";
import { localToday } from "./rehab.js";

export interface RecoveryOptions {
  now?: () => Date; // tests pin the clock
}

const angle = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "use a spec angle name such as knee");
const rangeInput = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

async function rangeFor(
  db: Db,
  me: string,
  input: z.infer<typeof rangeInput>,
  today: string,
  timeZone: string,
): Promise<ReportRange> {
  const fallback = await defaultRange(db, me, today, timeZone);
  const from = input.from ?? fallback.from;
  const to = input.to ?? (input.from && input.from > today ? input.from : today);
  if (to < from) throw badRequest("to must be on or after from");
  if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS)
    throw badRequest(`A report covers at most ${MAX_REPORT_DAYS / 7} weeks`);
  return { from, to, timeZone };
}

/** Routes that don't need a token: a shared report is opened by a physio without an account. */
export function publicRecoveryRouter(db: Db, options: RecoveryOptions = {}): Router {
  const router = Router();
  router.get("/reports/:token", async (req, res) => {
    const token = req.params.token;
    const share = TOKEN.test(token) ? await resolveShare(db, token, options.now?.()) : null;
    if (!share) throw notFound("Report"); // missing, expired and revoked look the same
    const today = localDate(options.now?.() ?? new Date(), share.timeZone);
    const report = await physioReport(
      db,
      share.userId,
      { from: share.fromDate, to: share.toDate, timeZone: share.timeZone },
      today,
    );
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.type("html").send(reportHtml(report, share.expiresAt));
  });
  return router;
}

export function recoveryRouter(db: Db, options: RecoveryOptions = {}): Router {
  const router = Router();
  const today = (req: Parameters<typeof localToday>[0]) => localToday(req, options.now?.());

  router.get("/me/rom-trend", async (req, res) => {
    const { timeZone: _tz, date } = today(req);
    const q = parse(
      z.object({ angle, weeks: z.coerce.number().int().min(1).max(52).default(12) }).passthrough(),
      req.query,
    );
    const trend = await romTrendFor(db, userId(req), q.angle, addDays(date, -7 * q.weeks + 1), date);
    send(res, { ...trend, disclaimer: REPORT_DISCLAIMER });
  });

  router.get("/me/physio-report", async (req, res) => {
    const me = userId(req);
    const { timeZone, date } = today(req);
    const range = await rangeFor(db, me, parse(rangeInput.passthrough(), req.query), date, timeZone);
    send(res, await physioReport(db, me, range, date));
  });

  router.post("/me/physio-report/share", async (req, res) => {
    const me = userId(req);
    const { timeZone, date } = today(req);
    const body = parse(
      rangeInput
        .extend({ expires_in_days: z.number().int().min(1).max(30).default(SHARE_DAYS_DEFAULT) })
        .strict(),
      req.body ?? {},
    );
    const range = await rangeFor(db, me, body, date, timeZone);
    const share = await createShare(db, me, range, body.expires_in_days, options.now?.());
    send(
      res,
      {
        id: share.id,
        path: `/reports/${share.token}`,
        from: range.from,
        to: range.to,
        expiresAt: share.expiresAt,
      },
      201,
    );
  });

  router.get("/me/physio-report/shares", async (req, res) => {
    send(res, await listShares(db, userId(req), options.now?.()));
  });

  router.delete("/me/physio-report/shares/:id", async (req, res) => {
    await revokeShare(db, userId(req), parse(z.string().uuid(), req.params.id));
    res.status(204).end();
  });

  router.get("/me/milestones", async (req, res) => {
    const { date } = today(req);
    send(res, await currentMilestone(db, userId(req), date, options.now?.()));
  });

  router.post("/me/milestones/:id/accept", async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const { share_post } = parse(
      z.object({ share_post: z.boolean().default(false) }).strict(),
      req.body ?? {},
    );
    send(res, await acceptMilestone(db, userId(req), id, share_post));
  });

  router.post("/me/milestones/:id/dismiss", async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    send(res, await dismissMilestone(db, userId(req), id, options.now?.()));
  });

  return router;
}
