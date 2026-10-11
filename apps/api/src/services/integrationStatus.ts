// INT-04: what GET /health reports for each integration. "disabled" when its env isn't set,
// "live" when it's configured and its last real call worked (or it hasn't been called yet), and
// "error" when its last call failed. Only the state, a coarse reason and times are kept, never
// error messages: those can carry hosts or ids from the env.

export type IntegrationName =
  "databricks_export" | "insight_sync" | "set_scoring" | "llm" | "moderation" | "embeddings" | "cloud_pose";

export type IntegrationState = "live" | "disabled" | "error";

export interface IntegrationReport {
  status: IntegrationState;
  reason?: string; // coarse, e.g. "timeout", "http_403", "partial"
  last_ok_at?: string;
  last_error_at?: string;
}

/** A coarse, env-free reason for a failure: an HTTP status or a timeout, else "failed". */
export function reasonOf(err: unknown): string {
  const status =
    (err as { httpResponse?: { status?: number }; status?: number; statusCode?: number })?.httpResponse
      ?.status ??
    (err as { status?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof status === "number") return `http_${status}`;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/timeout|timed out|aborted/i.test(text)) return "timeout";
  const http = text.match(/\bHTTP (\d{3})\b|\b(40[0-9]|5\d\d)\b/);
  return http ? `http_${http[1] ?? http[2]}` : "failed";
}

export class IntegrationStatus {
  private readonly reports = new Map<IntegrationName, IntegrationReport>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Call once at boot for every integration. */
  configure(name: IntegrationName, enabled: boolean): void {
    this.reports.set(name, { status: enabled ? "live" : "disabled" });
  }

  ok(name: IntegrationName): void {
    const r = this.reports.get(name);
    if (!r || r.status === "disabled") return;
    this.reports.set(name, { ...r, status: "live", reason: undefined, last_ok_at: this.now().toISOString() });
  }

  fail(name: IntegrationName, reason: string): void {
    const r = this.reports.get(name);
    if (!r || r.status === "disabled") return;
    this.reports.set(name, { ...r, status: "error", reason, last_error_at: this.now().toISOString() });
  }

  snapshot(): Partial<Record<IntegrationName, IntegrationReport>> {
    return Object.fromEntries(this.reports);
  }
}

/**
 * Runs one integration call and records how it went. `failure` turns a result that resolved but
 * still means the integration didn't do its job (a fallback, an "error" reply) into a reason;
 * null means it worked, undefined means it says nothing either way (e.g. no reps to score).
 * Throws what the call throws, so callers keep their own fallbacks.
 */
export async function tracked<T>(
  status: IntegrationStatus,
  name: IntegrationName,
  call: () => Promise<T>,
  failure: (result: T) => string | null | undefined = () => null,
): Promise<T> {
  try {
    const result = await call();
    const reason = failure(result);
    if (reason === null) status.ok(name);
    else if (reason !== undefined) status.fail(name, reason);
    return result;
  } catch (err) {
    status.fail(name, reasonOf(err));
    throw err;
  }
}
