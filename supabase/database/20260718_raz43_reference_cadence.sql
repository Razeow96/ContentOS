-- RAZ-43 · Reference harvest v2 — per-row cadence + trigger rules + ref_kind.
-- REVISED 2026-07-19 after /code-review (10 findings): scheduler state now lives fully
-- in SQL via an atomic claim function (api_gate_acquire precedent) — the edge function
-- no longer selects-then-patches. IDEMPOTENT: safe to re-run.
--
-- Model (owner-confirmed 2026-07-18): one dumb ticker, smart table.
--   cadence      — user-set string: daily | weekly | monthly. NULL = on-demand only.
--   next_run_at  — due marker, defaulted+checked so a cadence row can never be born dead.
--   trigger_rule — user-set string, NULL = scheduled only.
--   ref_kind     — competitor | lifestyle, carried into the SourceEnriched payload.
--   ref_harvest_claim() — THE due path: atomically claims due rows (gate-joined,
--   FOR UPDATE SKIP LOCKED) and advances next_run_at on the slot grid. One statement =
--   no race, no partial advance, no drift, no swallowed per-row failures.

-- 1. Columns
alter table page_reference_sources
  add column if not exists cadence text
    check (cadence is null or cadence in ('daily','weekly','monthly'));
alter table page_reference_sources
  add column if not exists next_run_at timestamptz default now();
alter table page_reference_sources
  add column if not exists trigger_rule text;
alter table page_reference_sources
  add column if not exists ref_kind text not null default 'competitor'
    check (ref_kind in ('competitor','lifestyle'));

-- Review fix (finding: dead rows): next_run_at defaults to now() and a CHECK couples it
-- to cadence — a row with a cadence but no due marker cannot exist.
alter table page_reference_sources alter column next_run_at set default now();
update page_reference_sources set next_run_at = now()
 where cadence is not null and next_run_at is null;
alter table page_reference_sources drop constraint if exists page_reference_sources_cadence_due_ck;
alter table page_reference_sources add constraint page_reference_sources_cadence_due_ck
  check (cadence is null or next_run_at is not null);

-- 2. Backfill from the superseded harvest_schedule model, then DROP the old column.
-- Review fix (finding: dual truth): two writable scheduling truths invited silently-dead
-- rows and re-apply behavior changes. Guarded DO block so this file stays re-runnable
-- after the column is gone.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'page_reference_sources' and column_name = 'harvest_schedule') then
    update page_reference_sources
       set cadence = 'daily', next_run_at = coalesce(next_run_at, now())
     where harvest_schedule = 'daily' and cadence is null;
    alter table page_reference_sources drop column harvest_schedule;
  end if;
end $$;

comment on column page_reference_sources.cadence is
  'daily | weekly | monthly | NULL(on-demand). User-set; scheduler state lives here, not in n8n. (RAZ-43)';
comment on column page_reference_sources.next_run_at is
  'Due marker. Claimed+advanced atomically by ref_harvest_claim(); defaults to now() on insert. (RAZ-43)';
comment on column page_reference_sources.trigger_rule is
  'User-set string; NULL = scheduled only. Non-null = row also fires on a matching trend event (scope=triggered, pages+trend required). (RAZ-43)';
comment on column page_reference_sources.ref_kind is
  'competitor | lifestyle - inspiration class, carried into SourceEnriched payload. (RAZ-43)';

-- 3. Due index — predicate matches the claim query exactly (review fix: was (next_run_at)
-- where enabled, which indexed on-demand rows and bought nothing).
drop index if exists page_reference_sources_due_idx;
create index if not exists page_reference_sources_due_idx
  on page_reference_sources (next_run_at)
  where enabled and cadence is not null;

-- 4. Atomic claim (review fix — replaces the edge function's select-then-patch):
--    · gate-joined: rows on sources_enabled=false pages are neither claimed nor advanced;
--      on re-enable each fires exactly ONCE (the WHILE walks next_run_at to the first
--      FUTURE slot, so there is no catch-up spam and no burst repetition).
--    · FOR UPDATE SKIP LOCKED: overlapping calls cannot claim the same row — no double
--      Bright Data spend on a race.
--    · steps from the STORED next_run_at on the slot grid: a 06:00 slot stays a 06:00
--      slot forever (no per-tick drift). Monthly uses calendar-month arithmetic
--      (Jan 31 -> Feb 28 -> Mar 28: Postgres interval rules, sane and documented).
--    · claim and advance are one transaction: a failure advances nothing and returns
--      nothing — the "advanced but never planned" and "planned but never advanced"
--      states cannot exist.
create or replace function ref_harvest_claim()
returns setof page_reference_sources
language plpgsql as $$
declare
  r    page_reference_sources%rowtype;
  step interval;
  nxt  timestamptz;
begin
  for r in
    select prs.*
      from page_reference_sources prs
      join page_source_settings pss
        on pss.page_id = prs.page_id and pss.sources_enabled
     where prs.enabled
       and prs.cadence is not null
       and prs.next_run_at <= now()
     for update of prs skip locked
  loop
    step := case r.cadence
              when 'daily'  then interval '1 day'
              when 'weekly' then interval '7 days'
              else               interval '1 month'
            end;
    nxt := r.next_run_at;
    while nxt <= now() loop
      nxt := nxt + step;
    end loop;
    update page_reference_sources set next_run_at = nxt where id = r.id;
    return next r;
  end loop;
end $$;

-- Verify:
--   select id, page_id, platform, cadence, next_run_at, trigger_rule, ref_kind
--     from page_reference_sources order by id;
--   select * from ref_harvest_claim();  -- claims + advances due rows (side effect!)
-- Rollback:
--   drop function if exists ref_harvest_claim();
--   alter table page_reference_sources
--     drop constraint if exists page_reference_sources_cadence_due_ck,
--     drop column if exists cadence, drop column if exists next_run_at,
--     drop column if exists trigger_rule, drop column if exists ref_kind;
--   drop index if exists page_reference_sources_due_idx;
