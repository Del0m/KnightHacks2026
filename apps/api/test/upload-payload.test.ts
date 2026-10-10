// CONN-02 / CONN-14: what the session metadata may carry about injuries.
import { describe, expect, it } from "vitest";
import {
  buildMetadata,
  injuryGroup,
  type FinishedSession,
  type UploadConfig,
} from "../src/integrations/databricks/upload.js";

const config = { pseudonymSecret: "test-pseudonym-secret-123456" } as UploadConfig;
const session = (extra: Partial<FinishedSession>): FinishedSession => ({
  id: "s1",
  user_id: "u1",
  started_at: "2026-10-10T10:00:00Z",
  finished_at: "2026-10-10T10:30:00Z",
  device: "iPhone",
  inference_mode: "on_device",
  medal: null,
  form_score: null,
  experience_level: null,
  injury_groups: [],
  sets: [],
  ...extra,
});

describe("injury tags in the Databricks payload", () => {
  it("adds a coarse side only when it is left, right or both", () => {
    expect(injuryGroup("knee", "left")).toBe("knee:left");
    expect(injuryGroup("shoulder", "both")).toBe("shoulder:both");
    expect(injuryGroup("knee", "n/a")).toBe("knee");
    expect(injuryGroup("knee", null)).toBe("knee");
  });

  it("drops anything that isn't a coarse tag, and any malformed rehab date", () => {
    const meta = buildMetadata(
      session({
        injury_groups: ["knee:left", "lower_back", "knee: torn ACL in March", "2026-03-01", "wrist:sideways"],
        rehab_start_on: "last tuesday",
      }),
      config,
      "joints/x.ndjson.gz",
    );
    expect(meta.injury_groups).toEqual(["knee:left", "lower_back"]);
    expect(meta.rehab_start_on).toBeNull();
    expect(buildMetadata(session({ rehab_start_on: "2026-09-01" }), config, "j").rehab_start_on).toBe(
      "2026-09-01",
    );
  });
});
