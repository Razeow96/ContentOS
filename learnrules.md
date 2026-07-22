## updating session.md ##
only update the session.md when its informed
updating the session.md by replacing all the information from past session record
keep the document lean without any expired info

## Tracking discipline
- Keep Linear status honest and current — move issues to Done/In Review as work actually completes, don't just comment. He will call out a board that doesn't match reality.
- **Claude is the PM: MARK IT DONE.** When every acceptance criterion is met AND verified with real evidence, move it to **Done** yourself — do not park verified work in In Review waiting for approval. Nobody is coming to approve it, and a board where nothing reaches Done is just as dishonest as one that over-claims.
- **In Review means one thing only: built but NOT yet verified** (e.g. needs a live run, a browser click-test, a scheduled trigger to fire). State the missing evidence in a comment. If it is verified, it is Done.
- Never mark Done on "it returned rows" or "the code looks right" — Done needs the acceptance criteria actually exercised. Cite the evidence in a comment.
- any mismatch documented feature or requirement do open discussion with user before implement any changes

note : treat linear as software documentation and project management including stakeholder communication

## Linear before code (spec-of-record)
- Every feature or change we discuss and agree gets its Linear issue written/updated FIRST — scope, key decisions, acceptance criteria — BEFORE any code. Linear is the spec-of-record; code follows the ticket, never the reverse.
- This is an order rule, not an approval gate — it does not reinstate the contract-approval wait for additive event changes (CLAUDE.md invariant #7). Capture the decision in Linear, then build.

## Go-live is the owner's, not Claude's
- MARK IT DONE is about the Linear board only. Activation · publishing · cutover · migration · commits are Raze's decisions on Raze's timeline — NEVER performed autonomously, NOT "remaining work", NOT blockers.
- State a go-live prerequisite once, in its issue. Then drop it unless Raze asks. "Done" (built + verified) and "live" (Raze flipped it on) are different states; a feature is Done without being live.

## Hard boundaries
- Never put secrets in files/code (they get committed). Use n8n credentials or Supabase secrets; reference by name.
- Never touch the live legacy workflows (A/B/C) except an explicit, logged patch.
- Never let one domain read/write another's tables — events only.

## field_map verification
- Never write a field_map from docs/screenshots/samples. Write it from ONE real captured payload.
- "It returned rows" is NOT verified. Read the raw record's keys: select payload->'raw' from source_events (raw is retained on every event).
- Two bug signatures: field 0/N populated = key doesn't exist. Field 1-distinct across N = you mapped a page/parent-level field.
- Only write "VERIFIED" in notes with the date + sample size you actually read. Never generalise from a null.

## UI / write-path rules (2026-07-17 admin review)
- Replace-writes are INSERT-FIRST: POST the new rows, then DELETE stale by id. Delete-then-insert destroys data when the second call fails.
- Every button that writes gets an in-flight guard. A double-click on an event-emitting action double-emits — the backend's read+flip is not atomic.
- Every fetch checks res.ok, and a 2xx that isn't the expected shape is an error — never count a dispatch as fired, or return null for a caller to deref.
- Read the whole response: an `errors` array on an ok-ish (207) response is a partial failure to surface, not a success.
- After any await that ends in a repaint, re-check the screen/state is still current; `finally` must reset busy state even when the follow-up reload throws.
- A partition over catalog entries must be exhaustive — every entry lands in a bucket or renders as unknown, never silently dropped.

## Hard output constraints are code, never prose (2026-07-19)
- An LLM cannot count characters while it writes, and trained habits beat style bans. Any output constraint with "no room of error" (length ranges, forbidden characters, required fields) MUST be validated in code AFTER generation — one auto-revise pass, then flags on the row. Never trusted to the prompt alone.
- Prose steers, the validator guarantees. Applies to every generative domain (M3 copy, M4 image prompts, Publishing captions), not just the one where it was found.
- Proven: a draft came back 480 chars against an 800–1200 range, and dashes survived an explicit identity rule; the m3-generate validator fixed both classes systemically.

## API rate-limit gate
- EVERY outbound API call, any platform, passes through the rate-limit setup BEFORE it is configured or fired. No direct raw calls from adapters or n8n.
- Limits are budgets, not just req/sec: paid APIs bill per RECORD — a per-provider daily record/credit budget is what would have saved the trial.
- A job still running at timeout = the job spec is unbounded, not a slow platform. Diagnose the spec; never re-fire with a longer window.
- Always cap discovery (limit_per_input) and always CANCEL the snapshot on giveup — providers keep collecting (and billing) after you stop polling.
- FETCH WRAPPER APPROVAL: every outbound call in edge functions goes through guardedFetch (supabase/functions/m0-infrastructure/rate-limit). acquire() must return allowed=true or the call DOES NOT FIRE — no raw fetch() in adapters, fail-closed, unconfigured provider = denied.
- ONE exception: the BD schema probe (deliberately-invalid payload, rejected before any crawl = free). Valid payloads NEVER go on the raw path.

## Pipeline flow, memory & tool honesty (2026-07-21 · M1→M3 review)
Proven this session by drawing and running the M1→M3 flow. The FIXES (trend-joined pull, per-entity cap, draft persistence) are Linear spec, NOT rules — only these observations are.
- **A review doc is not the database.** The dedup "memory" reads persisted `content_items`; if drafts aren't persisted, dedup is blind and topics repeat. (proven: `content_items` held 1 pre-today row → 奧德賽 recurred across days and 3 pillars). Persist, or don't trust dedup.
- **One page = one id, everywhere.** A page addressed by two ids across domains silently skips downstream. (proven: trend page `jello_topmovie_svs` ≠ identity `jello` → M3 skipped "no identity"). Verify id parity across domains before wiring a handoff.
- **Material depth, not the trend, decides a draft.** A thin source (a catalog card: title/date/poster) makes the generator refuse; only rich evidence drafts. "It ran" ≠ "it produced" — judge the material depth. (proven: TMDB refused 3/4, article feeds drafted).
- **Never report a tool/surface as done without verifying it's connected.** Claimed an Eraser board existed when it was only a repo text file; the Eraser MCP wasn't connected that session. Check the tool is actually available before acting or reporting done.
- **The pipeline contract lives in a drawing, not only in prose.** Structural gaps (a dead webhook, an id drift, a missing capability, a missing output) hide between domains. Keep the flow diagrams in `docs/diagramflows/` current per change — update the diagram in the same change as the code.

## Right stack from the start — logic doesn't belong on a light platform (2026-07-21)
- A low-code/automation platform (n8n today, any similar tool tomorrow) does exactly THREE things well: trigger, schedule, report status. **Event-consumption, high fan-out, data-heavy compute, and business logic do NOT belong there** — they go in real code (Supabase Edge Functions / SQL) from the FIRST build, never as a "quick" node graph you'll redo.
- Before building anything on a light platform, ask one question: *is this a trigger/schedule/status, or is it logic/consumption/heavy data?* Only the former stays. Default to code; justify anything logic-shaped that lives on the light platform.
- Proven cost: putting the M2/M3 event consumers and the BD harvest download on n8n Cloud felt fast, but a routine trend burst (4–5 concurrent fat webhooks) OOM-killed the whole container — and the fix is a full migration of every consumer to edge functions (RAZ-63). Quick setup on a light platform = a guaranteed, larger redo at scale.
- **Building it properly with Claude is cheap.** Do NOT trade solid ground for a fast hack to save tokens/time — Claude makes the correct implementation fast, so spend the pass to build it right once. The token/time cost of a real code build is far smaller than the cost of shipping on a weak foundation and rebuilding later (plus the live breakage in between). This applies to every platform choice, not just n8n.