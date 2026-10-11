# Hands-free camera setup and workout posts

The final framing step requires no tap: one continuous second of fresh, fully framed pose results confirms readiness. Lost/stale tracking resets the hold. The selected camera carries into the workout. Rear cameras with a torch give one 200 ms pulse before advancing and one pulse before returning a completed camera set. Front/no-torch cameras advance without a light pulse. Timers are canceled on unmount; backgrounding turns the torch off. Manual tracking and permission fallbacks remain.

The redundant Start workout footer is hidden in the final framing step. Permission, camera selection and manual fallback controls stay reachable before stepping into position.

Sharing remains explicit. A workout post includes the server medal, completion date, completed exercises with set/rep totals, the API-provided author name, and positive measured highlights. New personal records and a positive form comparison can be highlighted; absent improvement data uses completion language. Injury notes and per-rep faults stay out of the public payload. Older posts still render their body.

Verify one-second/reset framing boundaries, one-shot pulses, front/no-torch behavior, timer cleanup, completed-set handoff, positive summary generation and older/new feed cards. Run mobile tests/typecheck/lint. Actual framing, flashlight visibility and set-completion timing require a physical iPhone check.

## Verification — 2026-10-10

Mobile: 67 suites / 651 tests passed; TypeScript passed; lint passed with eight existing warnings; web export passed. Tests cover lost framing/reset, the one-second boundary, rear/front behavior, automatic and manual set endings, duplicate completion, disabled exits during the pulse, timer cleanup, manual PR filtering, and Feed cards. Focused independent review found and verified fixes for the manual-switch completion race and unmeasured PR highlights. Private env-value scan passed; only env examples and the API env loader are tracked.

Public posting stays opt-in and requires an account/server result; no real public post was created during tests. Physical torch visibility and rear-camera setup timing still require the owner’s iPhone check.
