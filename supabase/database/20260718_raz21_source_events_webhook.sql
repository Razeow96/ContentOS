-- RAZ-21 · push delivery for the source_events stream (RAZ-7/RAZ-26 pattern)
-- Fires the M3 Source Consumer placeholder (n8n) on every SourceEnriched INSERT.
-- M3 Content Generation does not exist yet; per the issue the subscriber is a
-- PLACEHOLDER: receive -> dedup on event_id -> no-op. When M3 is built it takes
-- over this endpoint (or the trigger URL is repointed) — the delivery contract
-- and seen-log are already in place.
--
-- No shared-secret header: the trigger definition lives in this committed file,
-- and secrets never go in files (learnrules hard boundary). Same decision as the
-- accepted RAZ-26 trend webhook.
--
-- Idempotent; safe to re-run.

-- Seen-log for the future Content Generation consumer (dedup on event_id)
create table if not exists gen_processed (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);

drop trigger if exists source_events_to_m3_consumer on source_events;

create trigger source_events_to_m3_consumer
  after insert on source_events
  for each row
  execute function supabase_functions.http_request(
    'https://razeow.app.n8n.cloud/webhook/m3-source-consumer',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );

-- Verify:
--   select tgname, tgenabled from pg_trigger where tgname = 'source_events_to_m3_consumer';
--
-- Rollback:
--   drop trigger if exists source_events_to_m3_consumer on source_events;
