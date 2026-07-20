-- M3 · Generation gate (RAZ-59) — dedup key persistence + gate config as data.
-- Dedup key = pillar_id × movie_name(angle_entity) × movie_year, over a 14-day
-- window. Same movie under a different pillar is allowed by design. Word-DNA
-- (shortforms/localizers) minimums per slang band move from prompt-prose to a
-- code-checked minimum. Idempotent; safe to re-run.

-- 1. Persist the third leg of the dedup key. angle_entity (movie/person) already
--    exists; movie_year makes the key deterministic across re-angled duplicates.
alter table content_items add column if not exists movie_year integer;

-- 2. Index the 14-day dedup lookup.
create index if not exists content_items_dedup_idx
  on content_items (page_id, pillar_id, angle_entity, movie_year, created_at desc);

-- 3. Gate config (config is data, never code): the dedup window + the minimum
--    number of word-DNA tokens (shortforms + localizers) the copy must actually
--    use, per slang band. Tune here, no redeploy.
insert into m3_config (key, value) values
  ('gate', '{"dedup_days":14,"min_lexicon":{"none":0,"low":1,"medium":2,"high":3,"extreme":4}}'::jsonb)
on conflict (key) do nothing;
