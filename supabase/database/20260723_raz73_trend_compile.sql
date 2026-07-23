-- RAZ-73 · Stage 3 — trend-joined compiled M2 pull
-- 1) page_source_settings.trend_bd_sources: BD AI-search (sync prompt family)
--    sources a page ALLOWS on the trend-compiled pull. Paid → opt-in by name,
--    same rule as everywhere. NULL / empty = none (fail-safe, no silent spend).
alter table page_source_settings
  add column if not exists trend_bd_sources text[] default null;

comment on column page_source_settings.trend_bd_sources is
  'RAZ-73: BD prompt-family source names (e.g. bd_google_ai) the trend-compiled pull may call for this page. NULL/empty = none.';

-- 2) m3_config generation.material_types += "compiled" so m3-generate accepts the
--    compiled trend brief (SourceEnriched v3, material_type="compiled").
update m3_config
set value = jsonb_set(value, '{material_types}', (value->'material_types') || '"compiled"'::jsonb)
where key = 'generation'
  and not (value->'material_types') ? 'compiled';
