# PR #121 API review fixes

Main is merged and `apps/api/src/integrations/huggingface/moderation.ts` is restored exactly from main, including S15/S16 and the prompt. Server branding is deferred as requested.

The phone currently uploads rep aggregates without frames. `start_ms` and `end_ms` are now null, as allowed by the set-record contract, rather than absolute Unix pose timestamps. Measured `tempo_ms` and `range_deg` remain intact. Before frame uploads are added, bounds and frame times must share a set-relative origin.

Upload errors retain their HTTP status. Permanent 4xx failures are retained in an account-scoped failed-workout list with payload, checkpoint, status, and failure time, and removed from the active queue only after being retained. Later jobs continue; the worker still rejects to indicate that some saves need attention. 401/403 authentication failures, 408/429 temporary failures, network errors, and server errors remain retryable. The phone's workout history is preserved in all cases.

Verified: 60 mobile suites / 620 tests passed; typecheck passed; lint has zero errors and eight existing warnings. Tests cover null rep bounds, permanent rejection without starving later workouts, account isolation, and transient retries. No lockfile changes.
