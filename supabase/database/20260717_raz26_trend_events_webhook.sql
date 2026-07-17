-- RAZ-26 · push delivery for the trend_events stream (RAZ-7 pattern)
-- Fires the M2 Trend Consumer (n8n 1gZQvoIfZULhdAiC) on every TrendDetected INSERT.
-- Push, not polling — ADR-001 invariant #3. Trend NEVER calls M2 directly; M2 reacts to the event.
--
-- Idempotency is handled downstream: the consumer INSERTs event_id into src_processed
-- (ON CONFLICT DO NOTHING) and only enriches when the insert actually returned a row.
-- Verified 2026-07-17: first delivery -> 20 SourceEnriched written; replay -> Enrich never runs.
--
-- Equivalent to Supabase Dashboard → Database → Webhooks, which generates this same trigger.
-- Requires the supabase_functions schema (already present — the RAZ-7 demo_events webhook uses it).

drop trigger if exists trend_events_to_m2_consumer on trend_events;

create trigger trend_events_to_m2_consumer
  after insert on trend_events
  for each row
  execute function supabase_functions.http_request(
    'https://razeow.app.n8n.cloud/webhook/m2-trend-consumer',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );

-- Verify:
--   select tgname, tgenabled from pg_trigger where tgname = 'trend_events_to_m2_consumer';
--
-- Rollback:
--   drop trigger if exists trend_events_to_m2_consumer on trend_events;
