-- M0 · Infrastructure — API rate-limit gate + audit ledger (learnrules: fetch wrapper approval)
-- Every outbound third-party API call must be APPROVED by api_gate_acquire before it fires
-- and is logged to api_request_log. Budgets are per-day and cover BOTH requests and RECORDS
-- (the 5,000-credit Bright Data burn was records, not request rate). Provider = URL hostname,
-- so a provider with no row here is DENIED — configuring the budget row IS the approval.

-- 1. Budgets (config is data — edit rows, never code)
create table if not exists api_rate_limits (
  provider             text primary key,          -- URL hostname, e.g. api.brightdata.com
  max_requests_per_day integer not null,
  max_records_per_day  integer,                   -- null = no record cap (e.g. pure-chat APIs)
  enabled              boolean not null default true,
  notes                text,
  updated_at           timestamptz not null default now()
);

-- 2. Daily usage counters (one row per provider per day)
create table if not exists api_usage_counters (
  provider text not null,
  day      date not null default current_date,
  requests integer not null default 0,
  records  integer not null default 0,
  primary key (provider, day)
);

-- 3. Append-only audit ledger — every attempt, allowed or denied
create table if not exists api_request_log (
  id                bigserial primary key,
  provider          text not null,
  method            text not null default 'GET',
  url               text,                          -- scrubbed by the wrapper before insert
  estimated_records integer not null default 0,
  records           integer,                       -- actual, reported after parse
  status            integer,                       -- HTTP status of the real call
  duration_ms       integer,
  allowed           boolean not null,
  deny_reason       text,
  requested_at      timestamptz not null default now()
);
create index if not exists api_request_log_at_idx on api_request_log (requested_at desc);
create index if not exists api_request_log_provider_idx on api_request_log (provider, requested_at desc);

-- 4. Atomic gate: check budgets, increment counters, write the ledger row.
create or replace function api_gate_acquire(
  p_provider text, p_method text, p_url text, p_est_records integer default 0
) returns jsonb language plpgsql as $$
declare
  cfg api_rate_limits%rowtype;
  cnt api_usage_counters%rowtype;
  v_log bigint;
  v_reason text;
begin
  select * into cfg from api_rate_limits where provider = p_provider;
  if not found or not cfg.enabled then
    v_reason := 'provider not configured/enabled in api_rate_limits';
    insert into api_request_log (provider, method, url, estimated_records, allowed, deny_reason)
      values (p_provider, p_method, p_url, coalesce(p_est_records,0), false, v_reason)
      returning id into v_log;
    return jsonb_build_object('allowed', false, 'reason', v_reason, 'log_id', v_log);
  end if;

  insert into api_usage_counters (provider, day) values (p_provider, current_date)
    on conflict (provider, day) do nothing;
  select * into cnt from api_usage_counters
    where provider = p_provider and day = current_date for update;

  if cnt.requests + 1 > cfg.max_requests_per_day then
    v_reason := format('daily request budget exceeded (%s/%s)', cnt.requests, cfg.max_requests_per_day);
  elsif cfg.max_records_per_day is not null
        and cnt.records + coalesce(p_est_records,0) > cfg.max_records_per_day then
    v_reason := format('daily record budget exceeded (%s + %s > %s)', cnt.records, coalesce(p_est_records,0), cfg.max_records_per_day);
  end if;

  if v_reason is not null then
    insert into api_request_log (provider, method, url, estimated_records, allowed, deny_reason)
      values (p_provider, p_method, p_url, coalesce(p_est_records,0), false, v_reason)
      returning id into v_log;
    return jsonb_build_object('allowed', false, 'reason', v_reason, 'log_id', v_log);
  end if;

  update api_usage_counters
    set requests = requests + 1, records = records + coalesce(p_est_records,0)
    where provider = p_provider and day = current_date;
  insert into api_request_log (provider, method, url, estimated_records, allowed)
    values (p_provider, p_method, p_url, coalesce(p_est_records,0), true)
    returning id into v_log;

  return jsonb_build_object('allowed', true, 'log_id', v_log,
    'requests_left', cfg.max_requests_per_day - cnt.requests - 1,
    'records_left', case when cfg.max_records_per_day is null then null
                         else cfg.max_records_per_day - cnt.records - coalesce(p_est_records,0) end);
end $$;

-- 5. Close the ledger row after the real call; reconcile estimated vs actual records.
create or replace function api_gate_report(
  p_log_id bigint, p_status integer, p_duration_ms integer, p_records integer default null
) returns void language plpgsql as $$
declare v_row api_request_log%rowtype;
begin
  select * into v_row from api_request_log where id = p_log_id;
  if not found then return; end if;
  update api_request_log
    set status = p_status, duration_ms = p_duration_ms, records = coalesce(p_records, records)
    where id = p_log_id;
  if p_records is not null then
    update api_usage_counters
      set records = greatest(0, records + p_records - v_row.estimated_records)
      where provider = v_row.provider and day = v_row.requested_at::date;
  end if;
end $$;

-- 6. Seed budgets. Bright Data deliberately tight after the trial burn.
insert into api_rate_limits (provider, max_requests_per_day, max_records_per_day, notes) values
  ('api.themoviedb.org',   2000, 50000, 'TMDB — free API, generous'),
  ('api.brightdata.com',   100,  300,   'Bright Data — PAID PER RECORD. Tight on purpose after the 5k trial burn.'),
  ('api.anthropic.com',    200,  null,  'Claude AI-assist — request-capped only'),
  ('trends.google.com',    500,  null,  'Google Trends RSS (M1, future wiring)'),
  ('www.googleapis.com',   500,  null,  'YouTube Data API (M1, future wiring)')
on conflict (provider) do nothing;
