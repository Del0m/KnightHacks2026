# FE-09 — Weekly planning

The Plan tab uses authenticated `GET /plans/current?tz=…` and `POST /plans/generate?tz=…` from BE-08. The time zone comes from the phone, and weeks begin on local Monday dates. Generate uses onboarding goals, schedule and limitations already stored on the account; server generation and rehabilitation errors remain visible with retry.

## Display and training

The seven-day selector remains above seven dated day cards. Each workout day lists its ordered exercises and set/rep prescriptions; other days say Rest day. Injury-swap notes stay visible. Tapping an item expands its reason, safety note and source titles/identifiers. BE-08 returns source titles and IDs, not citation URLs, so this screen does not invent links.

View workout selects that dated routine in Train. Camera/model mappings remain restricted to curl, squat, shoulder press, push-up and lunge. Unsupported library movements explicitly use manual logging rather than silently selecting curls. Existing manual sets remain local and unscored; only supported measured captures use the account upload path. The sample routine remains available for guests and before a personal plan exists.

The selected routine, date and plan ID are saved with a workout immediately upon entry, including before its first set. Regeneration cannot change an interrupted session. Each completed set retains the existing immediate durable save, stable index, rest and upload recovery behavior. A generated rest day cannot accidentally start the sample workout. Completion checkmarks follow the selected date rather than today's history.

## Cache and races

Plans and selection are durable and scoped by account and Monday date. Focus refresh preserves the cached week while offline; authoritative 404 clears the missing plan. Late account/focus responses are aborted and ignored; repeated generation taps share the synchronous request lock. Local date updates handle week rollover without a restart. New sessions validate their persisted prescription; corrupt snapshots cannot fall through into a different sample routine.

## Verification

Regression tests cover BE-08 parsing and endpoint methods, source/swap data, Monday boundaries, account/week isolation, unsupported model IDs, all seven dated headings, expanding sources, offline/404 behavior, account-switch response races, duplicate generation, prescription propagation, rest days, regeneration before/after the first set, differing rep targets when resuming across exercises, and selected-date completion indicators.

See `FE-09-FE-12-FE-13-Plan.md` for combined checks and delivery state. Physical acceptance: generate a week, expand an exercise, open one day in Train, record a set, leave/relaunch and verify the prescription and rest state are unchanged.
