-- M0 · Infrastructure — run_log invocation log (RAZ-58, security audit surface)
-- The producer/inbound counterpart to api_request_log (RAZ-42, outbound). One row
-- per function invocation: what ran, from which caller IP, did it finish, and what
-- it did. Paired with the rate-limit ledger, this is the security/monitor surface
-- mandated by CLAUDE.md invariant #8 (every execution path logs).
--
-- M0-owned. Edge functions write THROUGH the withRun helper (m0-infrastructure/
-- observability), n8n through the gate endpoint's {action:"log"} branch — same
-- write-through precedent as guardedFetch -> api_request_log, so not a cross-domain
-- write. Idempotent; safe to re-run.

create table if not exists run_log (
  id             bigint generated always as identity primary key,
  source         text not null,                 -- 'm1-trend' | 'm2-contentsource' | 'm3-generate' | 'n8n:<workflow>'
  action         text,                           -- mode/branch/outcome: 'run' | 'ingest' | 'draft' | 'skip'
  caller_ip      text,                           -- inbound caller (x-forwarded-for) — who triggered it
  status         text not null default 'started',-- started | ok | skip | error | crashed
  correlation_id uuid,                            -- ties into event_trace
  summary        jsonb,                           -- the counts the function already returns
  error          text,                            -- message on failure
  note           text,                            -- auto: "action · corr=… · <error snippet>"
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  duration_ms    integer
);
create index if not exists run_log_started_idx on run_log (started_at desc);
create index if not exists run_log_source_idx  on run_log (source, started_at desc);
create index if not exists run_log_status_idx  on run_log (status);
create index if not exists run_log_corr_idx    on run_log (correlation_id);

-- Auto-note composer: one place, so open/close/log all read the same.
create or replace function run_log_note(p_action text, p_correlation_id uuid, p_error text)
returns text language sql immutable as $$
  select concat_ws(' · ',
    nullif(p_action, ''),
    'corr=' || coalesce(p_correlation_id::text, '—'),
    case when p_error is not null and p_error <> '' then left(p_error, 160) else null end);
$$;

-- Crash reaper: a 'started' row that never closed = the isolate was killed
-- (timeout/OOM) before withRun's finally ran. Flip it to 'crashed' so it is
-- VISIBLE (message-less — the one honest limit). Self-contained: run_log_open
-- calls this on every invocation, so it needs no external scheduler; the hourly
-- n8n sweep MAY also call it, but nothing depends on that.
create or replace function run_log_reap(p_minutes integer default 15)
returns integer language plpgsql as $$
declare n integer;
begin
  update run_log
     set status      = 'crashed',
         finished_at = now(),
         duration_ms = (extract(epoch from (now() - started_at)) * 1000)::int,
         note        = concat_ws(' · ', note, 'reaped: no finish within ' || p_minutes || 'm')
   where status = 'started'
     and started_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

-- Open a run: reap stragglers first, then insert the 'started' row, return its id.
create or replace function run_log_open(p_source text, p_caller_ip text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  perform run_log_reap(15);
  insert into run_log (source, caller_ip, status)
    values (p_source, p_caller_ip, 'started')
    returning id into v_id;
  return v_id;
end $$;

-- Close a run: stamp outcome, duration, and the auto-note. No-op if id is gone.
create or replace function run_log_close(
  p_id bigint, p_action text, p_correlation_id uuid,
  p_status text, p_summary jsonb, p_error text
) returns void language plpgsql as $$
declare v_started timestamptz;
begin
  select started_at into v_started from run_log where id = p_id;
  if not found then return; end if;
  update run_log set
    action         = coalesce(p_action, action),
    correlation_id = coalesce(p_correlation_id, correlation_id),
    status         = coalesce(p_status, 'ok'),
    summary        = coalesce(p_summary, summary),
    error          = p_error,
    finished_at    = now(),
    duration_ms    = (extract(epoch from (now() - v_started)) * 1000)::int,
    note           = run_log_note(p_action, p_correlation_id, p_error)
  where id = p_id;
end $$;

-- One-shot logger for callers that report AFTER the fact (n8n workflows via the
-- gate endpoint): insert an already-closed row. started_at is back-dated from the
-- reported duration so the timeline reads correctly.
create or replace function run_log_log(
  p_source text, p_action text, p_caller_ip text, p_correlation_id uuid,
  p_status text, p_summary jsonb, p_error text, p_duration_ms integer
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  perform run_log_reap(15);
  insert into run_log (source, action, caller_ip, correlation_id, status, summary, error,
                       started_at, finished_at, duration_ms, note)
    values (p_source, p_action, p_caller_ip, p_correlation_id,
            coalesce(p_status, 'ok'), p_summary, p_error,
            now() - coalesce(make_interval(secs => p_duration_ms / 1000.0), interval '0'),
            now(), p_duration_ms,
            run_log_note(p_action, p_correlation_id, p_error))
    returning id into v_id;
  return v_id;
end $$;

-- Retention: DELIBERATELY unbounded for now. This is a security audit trail —
-- auto-deleting evidence is the wrong default. Add a prune (sweep deletes rows
-- older than N days) only on an explicit owner decision (RAZ-58 open item).
