-- RAZ-49 · m3-generate foundation: validator flags + generation config.
-- IDEMPOTENT: safe to re-run.

-- Validator results live on the draft (range_violation / pattern_violation flags,
-- revise counts). Deterministic code checks — prose steers, the validator guarantees.
alter table content_items
  add column if not exists validation jsonb not null default '{}'::jsonb;
comment on column content_items.validation is
  'Post-generation validator results: {char_count, range_ok, pattern_ok, revised, flags[]}. (RAZ-49)';

-- Generation config as data (RAZ-55 lesson: no hardcoded models/params in code).
insert into m3_config (key, value) values
  ('generation', '{"model":"claude-sonnet-5","max_tokens":3000,"daily_draft_cap":20,"material_types":["article","movie","listing"]}'::jsonb)
on conflict (key) do nothing;

-- Verify:
--   select key, value from m3_config;
--   select column_name from information_schema.columns where table_name='content_items' and column_name='validation';
