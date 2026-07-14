-- M2 · Content Sources — SQL foundation
-- Stream (RAZ-21) + config/state tables. Additive only; Workflows A/B/C untouched.
-- Idempotent (create ... if not exists); safe to re-run / supabase db push.

-- 1. source_events stream (envelope template; only writer = Content Sources) — RAZ-21
create table if not exists source_events (
  event_id       uuid primary key default gen_random_uuid(),
  event_type     text not null default 'SourceEnriched',
  schema_version int  not null default 1,
  aggregate_id   text not null,
  correlation_id uuid not null,
  causation_id   uuid,
  payload        jsonb not null,
  occurred_at    timestamptz not null default now()
);
create index if not exists source_events_correlation_idx on source_events (correlation_id);
create index if not exists source_events_occurred_idx    on source_events (occurred_at);

-- 2. Per-page gate: a page emits material only when sources_enabled = true
create table if not exists page_source_settings (
  page_id         text primary key,
  sources_enabled boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- 3. Which API adapters run per page (TMDB, listings, ...)
create table if not exists page_material_sources (
  id         bigint generated always as identity primary key,
  page_id    text not null,
  source     text not null,
  params     jsonb not null default '{}'::jsonb,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
-- A page may subscribe to the same source with different param-sets (e.g. TMDB
-- list=now_playing vs upcoming, or zh-TW vs en-US). Unique on the param-set.
create unique index if not exists page_material_sources_uq on page_material_sources (page_id, source, md5(params::text));

-- 4. Reference-page harvest config (RAZ-36) — two togglable strategies per row
create table if not exists page_reference_sources (
  id          bigint generated always as identity primary key,
  page_id     text not null,
  platform    text not null,   -- facebook | instagram | tiktok | x | youtube | linkedin
  ref_url     text not null,
  strategy    text not null default 'latest_n' check (strategy in ('latest_n','best_performing')),
  window_days int  check (window_days in (7,14,30,60,90,365)),  -- null for latest_n
  cap         int  not null default 10,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 5. Article sources (RAZ-25) — rss (feed) or scrape (no-feed site)
create table if not exists page_article_sources (
  id         bigint generated always as identity primary key,
  page_id    text not null,
  mode       text not null check (mode in ('rss','scrape')),
  url        text not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

-- 6. Dedup / freshness state (mirror of trends): unique (source+external_id) per window_day
create table if not exists source_material (
  id              bigint generated always as identity primary key,
  dedup_key       text not null,
  raw_material_id uuid not null default gen_random_uuid(),
  source          text not null,
  material_type   text not null,
  external_id     text,
  window_day      date not null default current_date,
  detected_at     timestamptz not null default now(),
  unique (dedup_key, window_day)
);

-- 7. Idempotency seen-log for the trend consumer (dedup on event_id)
create table if not exists src_processed (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
