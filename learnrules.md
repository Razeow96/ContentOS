## updating session.md ##
only update the session.md when its informed
updating the session.md by replacing all the information from past session record
keep the document lean without any expired info

## Tracking discipline
- Keep Linear status honest and current — move issues to Done/In Review as work actually completes, don't just comment. He will call out a board that doesn't match reality.
any mismatch documented feature or requirement do open discussion with user before implement any changes

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