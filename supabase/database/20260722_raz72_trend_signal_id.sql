-- RAZ-72 (Stage 2 of RAZ-61) · trend_signal_id lineage spine.
-- content_items gets a queryable trend_signal_id column so a draft traces back to
-- WHICH trend (campaign run) produced it. The value is written by m3-generate's
-- writer from the carried event payload; null off the trend path (run/promote/manual).
-- The field also rides in trend_events / source_events / content_events payloads
-- (jsonb — no DDL there). IDEMPOTENT.

alter table content_items add column if not exists trend_signal_id uuid;
create index if not exists content_items_trend_signal_idx on content_items (trend_signal_id);

-- Verify:
--   select column_name from information_schema.columns
--     where table_name='content_items' and column_name='trend_signal_id';
--
-- Rollback:
--   drop index if exists content_items_trend_signal_idx;
--   alter table content_items drop column if exists trend_signal_id;
