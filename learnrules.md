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

## Hard boundaries
- Never put secrets in files/code (they get committed). Use n8n credentials or Supabase secrets; reference by name.
- Never touch the live legacy workflows (A/B/C) except an explicit, logged patch.
- Never let one domain read/write another's tables — events only.

## field_map verification
- Never write a field_map from docs/screenshots/samples. Write it from ONE real captured payload.
- "It returned rows" is NOT verified. Read the raw record's keys: select payload->'raw' from source_events (raw is retained on every event).
- Two bug signatures: field 0/N populated = key doesn't exist. Field 1-distinct across N = you mapped a page/parent-level field.
- Only write "VERIFIED" in notes with the date + sample size you actually read. Never generalise from a null.

## API rate-limit gate
- EVERY outbound API call, any platform, passes through the rate-limit setup BEFORE it is configured or fired. No direct raw calls from adapters or n8n.
- Limits are budgets, not just req/sec: paid APIs bill per RECORD — a per-provider daily record/credit budget is what would have saved the trial.
- A job still running at timeout = the job spec is unbounded, not a slow platform. Diagnose the spec; never re-fire with a longer window.
- Always cap discovery (limit_per_input) and always CANCEL the snapshot on giveup — providers keep collecting (and billing) after you stop polling.
- FETCH WRAPPER APPROVAL: every outbound call in edge functions goes through guardedFetch (supabase/functions/m0-infrastructure/rate-limit). acquire() must return allowed=true or the call DOES NOT FIRE — no raw fetch() in adapters, fail-closed, unconfigured provider = denied.