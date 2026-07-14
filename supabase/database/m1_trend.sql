-- ============================================================================
-- M1 · Trend Intelligence (schema record)
-- Reverse-engineered from the live Supabase DB on 2026-07-13 (exact match).
-- Idempotent (create ... if not exists); safe to re-run / supabase db push.
-- Issues: RAZ-13,14,15,16,17,19,30,31. Writer = m1-trend edge function.
-- ============================================================================

-- trend_events stream (RAZ-13): only writer = Trend Intelligence.
create table if not exists trend_events (
  event_id       uuid primary key default gen_random_uuid(),
  event_type     text not null,
  schema_version int  not null default 1,
  aggregate_id   text not null,
  correlation_id uuid not null,
  causation_id   uuid,
  payload        jsonb not null,
  occurred_at    timestamptz not null default now()
);
create index if not exists trend_events_correlation_idx on trend_events (correlation_id);
create index if not exists trend_events_occurred_at_idx  on trend_events (occurred_at);
create index if not exists trend_events_type_idx         on trend_events (event_type);

-- trends dedup/freshness state (RAZ-14): unique per (dedup_key, window_day).
-- window_day is a STORED generated column (immutable index expr requirement).
create table if not exists trends (
  id           bigint generated always as identity primary key,
  dedup_key    text not null,
  raw_trend_id uuid not null,
  source       text not null,
  topic        text not null,
  region       text,
  country      text,
  language     text,
  timeframe    text,
  detected_at  timestamptz not null default now(),
  window_day   date generated always as (((detected_at at time zone 'UTC'))::date) stored
);
create unique index if not exists trends_dedup_day_idx on trends (dedup_key, window_day);

-- Per-page source subscriptions (RAZ-15): page x source + params.
create table if not exists page_trend_sources (
  id          bigint generated always as identity primary key,
  page_id     text not null,
  source_name text not null,
  region      text,
  language    text,
  country     text,
  category    text,
  keywords    text[],
  chart       text,
  max_results int,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists page_trend_sources_page_idx on page_trend_sources (page_id);

-- Per-page trend gate (RAZ-15): blocked-by-default; page needs trends_enabled=true.
create table if not exists page_trend_settings (
  page_id        text primary key,
  trends_enabled boolean not null default false
);

-- post_metrics (RAZ-19 analytics seed): FB engagement snapshots for the Learning corpus.
create table if not exists post_metrics (
  id           bigint generated always as identity primary key,
  post_id      text not null,
  page         text not null,
  collected_at timestamptz not null default now(),
  metrics      jsonb not null
);
create index if not exists post_metrics_post_collected_idx on post_metrics (post_id, collected_at);
