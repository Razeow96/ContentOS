-- ⚠️ SUPERSEDED (RAZ-43, 2026-07-19): harvest_schedule was replaced by cadence +
-- next_run_at and the column is DROPPED by 20260718_raz43_reference_cadence.sql.
-- Do NOT re-run this file — re-adding the column would resurrect a dead model.
--
-- M2 · Content Sources — per-page reference-harvest scheduling (RAZ-36)
-- Social scrapes (Bright Data) are async/minutes-long, so they run via n8n
-- orchestration (trigger -> snapshot -> ingest), never in-function sync.
-- Each reference page picks its own cadence: some harvest nightly, some only
-- when the operator triggers on demand. Both feed the SAME async harvest path.

alter table page_reference_sources
  add column if not exists harvest_schedule text not null default 'on_demand'
    check (harvest_schedule in ('daily', 'on_demand'));

comment on column page_reference_sources.harvest_schedule is
  'daily = nightly n8n harvest; on_demand = harvested only when the operator triggers. (RAZ-36)';
