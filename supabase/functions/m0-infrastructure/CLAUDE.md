# m0-infrastructure — M0 Infrastructure (the backbone + spend firewall)
- Owns the event envelope, dead_letter, safety sweep, the rate-limit gate, and
  the run_log observability surface (RAZ-58).
- run_log = one row per invocation (invariant #8: every execution path logs).
  Edge fns write THROUGH `observability/withRun`; n8n via the gate `{action:"log"}`
  branch — write-through, same precedent as guardedFetch → api_request_log.
  Crash reaper is self-contained (run_log_open reaps stale 'started' rows), so it
  needs no external scheduler.
- guardedFetch is the ONLY path for third-party calls. No budget row in
  api_rate_limits = DENIED — adding the row IS the approval step.
- The gate is fail-closed: if the gate itself errors, the answer is NO.
- Racy check-then-write logic belongs in plpgsql here (api_gate_acquire,
  ref_harvest_claim pattern), never in edge-function select-then-patch.

## Learned rules
(appended only after a mistake's fix is proven and Raze approves — see root CLAUDE.md)
