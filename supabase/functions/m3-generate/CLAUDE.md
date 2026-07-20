# m3-generate — M3 Content Generation (the brain)
- Only writer of `content_events` + `content_items`. Context comes from SQL ONLY
  (page_identity, char_*, pillar_catalog, subscriptions, m3_config) — no file
  reads, no cross-domain reads (D12). Facts come only from the delivered event.
- Prose steers, the VALIDATOR guarantees: char_range + forbidden_patterns +
  word-DNA presence (RAZ-59) are code-checked after generation → one auto-revise
  → flags, never silent.
- Dedup key = pillar_id × angle_entity(movie/person) × movie_year over the gate's
  dedup window (m3_config.gate). Same movie under a DIFFERENT pillar is allowed.
  The 14-day burned set is injected to steer AND enforced in code (index.ts) —
  never trust the steer alone. Gate tuning (dedup_days, min_lexicon per slang) is
  data in m3_config.gate, not code.
- tier=inspiration never generates directly (Rule 3). Model/params live in
  m3_config, never in code. Contract: ContentGenerated v1 (Linear).

## Learned rules
(appended only after a mistake's fix is proven and Raze approves — see root CLAUDE.md)
