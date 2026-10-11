// The shared date validator: dates JavaScript accepts but PostgreSQL rejects must be a 400.
import { describe, expect, it } from "vitest";
import { isoDate } from "./http.js";

describe("isoDate", () => {
  it("accepts real calendar dates PostgreSQL can store", () => {
    for (const d of ["2026-10-10", "2024-02-29", "0001-01-01", "9999-12-31"]) {
      expect(isoDate.safeParse(d).success).toBe(true);
    }
  });

  it("rejects impossible dates, year zero and other shapes", () => {
    // 2026-02-31 rolls over in Date.parse; 0000 round-trips in JavaScript but PostgreSQL has no year zero.
    for (const d of ["2026-02-31", "2025-02-29", "0000-01-01", "0000-12-31", "2026-1-01", "last week", ""]) {
      expect(isoDate.safeParse(d).success).toBe(false);
    }
  });
});
