-- ============================================================================
-- RAZ-37 · Manual AI keyword-search tool — isolated results store
-- Live-created 2026-07-14. Idempotent (create ... if not exists).
-- NOT a domain stream: a plain ops table, never auto-consumed. The only bridge
-- into the event flow is an explicit human "promote" (which emits SourceEnriched
-- into source_events). Manual exploration never auto-feeds Content Generation.
-- ============================================================================
create table if not exists manual_search_results (
  id            bigint generated always as identity primary key,
  keyword       text not null,
  source        text not null,
  material_type text,
  external_id   text,
  ai_assisted   boolean not null default false,
  status        text not null default 'new' check (status in ('new','promoted','discarded')),
  payload       jsonb not null,
  searched_at   timestamptz not null default now()
);
create index if not exists manual_search_results_status_idx on manual_search_results (status, searched_at);
