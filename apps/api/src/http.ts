// Shared HTTP helpers: errors, the error handler and response casing.
//
// The API speaks snake_case JSON, the same casing as the shared set record (AI-08 / CONN-02),
// while TypeScript and Drizzle use camelCase. Request bodies are parsed with snake_case Zod
// schemas, and responses go through `send`, which converts keys.
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { z, ZodError, type ZodTypeAny } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnake);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [camelToSnake(k), toSnake(v)]));
}

export function send(res: Response, body: unknown, status = 200): void {
  res.status(status).json(toSnake(body));
}

// A calendar date as YYYY-MM-DD that PostgreSQL will also accept. Checked by round trip, because
// Date.parse rolls impossible dates like 2026-02-31 over into March instead of rejecting them, and
// from year 0001, because JavaScript has a year 0000 and PostgreSQL doesn't. Either would otherwise
// reach the database and come back as a 500.
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d && d >= "0001-01-01";
  }, "not a real date");

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}

export function userId(req: Request): string {
  if (!req.user) throw new HttpError(401, "unauthorized", "Sign in to continue");
  return req.user.id;
}

// Postgres unique_violation, from either driver.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// Name of the unique constraint or index that a unique_violation hit, or null for any other error.
// Lets a handler with several unique constraints report the right one.
export function violatedUniqueConstraint(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  return e.constraint ?? e.cause?.constraint ?? null;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound("Route"));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_failed",
      message: "Some fields are missing or invalid",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  const status = (err as { status?: number; type?: string }).status;
  if (status === 413 || (err as { type?: string }).type === "entity.parse.failed") {
    res.status(status ?? 400).json({ error: "bad_request", message: (err as Error).message });
    return;
  }
  req.log?.error({ err }, "unhandled error");
  res.status(500).json({ error: "internal", message: "Something went wrong on our side" });
};
