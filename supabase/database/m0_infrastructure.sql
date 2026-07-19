-- ============================================================================
-- M0 · Infrastructure — event backbone (schema record)
-- Reverse-engineered from the live Supabase DB on 2026-07-13 (exact match).
-- Idempotent (create ... if not exists); safe to re-run / supabase db push.
-- Issues: RAZ-6..11.
-- ============================================================================

-- Envelope demo stream (RAZ-6/7): the reference stream every domain stream copies.
create table if not exists demo_events (
  event_id       uuid primary key default gen_random_uuid(),
  event_type     text not null,
  schema_version int  not null default 1,
  aggregate_id   text not null,
  correlation_id uuid not null,
  causation_id   uuid,
  payload        jsonb not null,
  occurred_at    timestamptz not null default now()
);

-- Idempotent-consumer seen-log template (RAZ-8): subscribers dedup on event_id.
create table if not exists demo_processed (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);

-- Dead-letter (RAZ-10): failed processing is visible, not silent.
create table if not exists dead_letter (
  id         bigint generated always as identity primary key,
  event_id   uuid not null,
  stream     text not null,
  subscriber text not null,
  error      text,
  failed_at  timestamptz not null default now()
);
create index if not exists dead_letter_failed_at_idx on dead_letter (failed_at);

-- Safety-sweep re-delivery counter (RAZ-10): counts attempts per dropped event.
create table if not exists sweep_attempts (
  event_id     uuid primary key,
  stream       text not null,
  attempts     int  not null default 0,
  last_attempt timestamptz not null default now()
);

-- content_queue — LEGACY table (predates DDD; drained by Workflow B, filled by
-- Workflow A). M0 (RAZ-11) HARDENED it in place: added attempts / last_error /
-- updated_at + the page/status index (+ a posting-timeout rule enforced by n8n).
-- id is the original serial sequence, preserved as-is.
create table if not exists content_queue (
  id            serial primary key,
  post_type     text,
  caption       text,
  image_prompt  text,
  status        text default 'pending',
  scheduled_for timestamptz,
  post_id       text,
  created_at    timestamptz default now(),
  posted_at     timestamptz,
  page          text,
  poster_url    text,
  attempts      int not null default 0,
  last_error    text,
  updated_at    timestamptz
);
create index if not exists idx_content_queue_page_status on content_queue (page, status);

-- End-to-end trace view (RAZ-9): one correlation_id traced across every stream.
-- MAINTENANCE: add a UNION ALL branch here for each new {domain}_events stream
-- (all streams share this envelope, so it's a one-liner). Referenced streams
-- trend_events/source_events live in the M1/M2 records — on a clean rebuild,
-- (re)create this view AFTER those tables exist.
create or replace view event_trace as
  select 'trend'::text   as stream, event_id, event_type, aggregate_id, correlation_id, causation_id, occurred_at, payload from trend_events
  union all
  select 'source'::text  as stream, event_id, event_type, aggregate_id, correlation_id, causation_id, occurred_at, payload from source_events
  union all
  select 'content'::text as stream, event_id, event_type, aggregate_id, correlation_id, causation_id, occurred_at, payload from content_events  -- RAZ-46
  union all
  select 'demo'::text    as stream, event_id, event_type, aggregate_id, correlation_id, causation_id, occurred_at, payload from demo_events;
