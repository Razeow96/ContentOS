-- RAZ-46 · content_events stream + delivery webhook (M3 · Content Generation)
-- Third stream on the backbone, from the INFRA envelope template (RAZ-6).
-- Only writer: Content Generation (D12). Delivery per the RAZ-7/RAZ-21 pattern:
-- DB trigger on INSERT -> POST full row to the n8n subscriber webhook.
--
-- Subscriber today = M4 placeholder (receive -> dedup on event_id -> no-op).
-- The owner's manual loop reads content_items directly (RAZ-47); M4 Publishing
-- takes over this endpoint when built. No shared-secret header: trigger DDL lives
-- in this committed file and secrets never go in files (learnrules hard boundary —
-- same decision as RAZ-26/RAZ-21).
--
-- Idempotent; safe to re-run.

-- 1. Stream table (envelope template)
create table if not exists content_events (
  event_id       uuid primary key default gen_random_uuid(),
  event_type     text not null default 'ContentGenerated',
  schema_version int  not null default 1,
  aggregate_id   text not null,
  correlation_id uuid not null,
  causation_id   uuid,
  payload        jsonb not null,
  occurred_at    timestamptz not null default now()
);
create index if not exists content_events_correlation_idx on content_events (correlation_id);
create index if not exists content_events_occurred_idx    on content_events (occurred_at);
create index if not exists content_events_type_idx        on content_events (event_type);

-- 2. Seen-log for the future Publishing consumer (dedup on event_id)
create table if not exists pub_processed (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);

-- 3. Delivery webhook -> M4 placeholder
drop trigger if exists content_events_to_m4_consumer on content_events;

create trigger content_events_to_m4_consumer
  after insert on content_events
  for each row
  execute function supabase_functions.http_request(
    'https://razeow.app.n8n.cloud/webhook/m4-content-consumer',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );

-- 4. event_trace: the content branch is added in the CANONICAL record —
--    m0_infrastructure.sql (its MAINTENANCE note: one UNION ALL per new stream,
--    added there per the 2026-07-19 review; a fork here would be reverted by any
--    m0 re-run). Re-run m0's view statement after this file on a clean rebuild.

-- Verify:
--   select tgname, tgenabled from pg_trigger where tgname = 'content_events_to_m4_consumer';
--   select distinct stream from event_trace;
--
-- Rollback:
--   drop trigger if exists content_events_to_m4_consumer on content_events;
--   drop table if exists pub_processed;
--   drop table if exists content_events;
--   (recreate event_trace without the content branch — see m0_infrastructure.sql)
