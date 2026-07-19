-- RAZ-47 · M3 foundation — pillar catalog + page subscriptions + content_items state.
-- IDEMPOTENT: safe to re-run. RAZ-44 pre-spec made concrete.
--
-- Model:
--   pillar_catalog            shared across ALL pages, niche-agnostic, versioned rows.
--                             Instruction change = INSERT a new (pillar_id, version) row,
--                             never UPDATE — at 100 pages you must know which version
--                             produced a post (audit).
--   page_pillar_subscriptions the tick — same registration model as page_trend_sources /
--                             page_reference_sources / page_article_sources. campaign-taggable.
--   content_items             M3 aggregate state: one row per draft. The owner's reading
--                             surface during the manual phase (SQL editor, no UI). Also the
--                             angle ledger: (page, entity, pillar) + cooldown = dedup grain.
--   m3_config                 cooldown windows etc. as DATA, never constants in code.
--
-- NOT created here: m3_processed — the M3 consumer's seen-log already exists as
-- gen_processed (RAZ-21). One consumer, one seen-log; a second table would split dedup.

-- 1. Shared pillar catalog (versioned)
create table if not exists pillar_catalog (
  id             bigint generated always as identity primary key,
  pillar_id      text not null,           -- stable slug, e.g. 'the_numbers'
  version        int  not null default 1,
  name           text not null,           -- display name, e.g. '數字 (the numbers)'
  description    text,
  instruction_md text not null,           -- niche-agnostic generation instruction (markdown)
  evidence_req   jsonb not null default '{}'::jsonb,  -- what claims/data the pillar demands
  format_hints   jsonb not null default '{}'::jsonb,  -- text/image/carousel/reel affinity
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (pillar_id, version)
);

-- 2. The tick: which page uses which pillar (unbounded roster, config-only onboarding)
create table if not exists page_pillar_subscriptions (
  id             bigint generated always as identity primary key,
  page_id        text not null,
  pillar_id      text not null,
  enabled        boolean not null default true,
  weight         int  not null default 1,             -- relative share in the page's mix
  overrides      jsonb not null default '{}'::jsonb,  -- per-page tweaks, never a fork
  pinned_version int,                                 -- null = follow latest enabled version
  campaign       text,                                -- AR-1 grouping label
  created_at     timestamptz not null default now(),
  unique (page_id, pillar_id)
);

-- 3. M3 aggregate state — one row per draft; owner reads/settles these manually
create table if not exists content_items (
  id              bigint generated always as identity primary key,
  page_id         text not null,
  pillar_id       text not null,
  pillar_version  int  not null,
  status          text not null default 'draft' check (status in ('draft','used','discarded')),
  draft           jsonb not null,                      -- { copy, title?, hashtags[], language }
  format_hint     text,
  entities        jsonb not null default '{}'::jsonb,
  evidence        jsonb not null default '[]'::jsonb,  -- [{claim,url,source,published_at}]
  media_refs      jsonb not null default '[]'::jsonb,  -- provenance-carrying reference media
  image_prompt    text,
  angle_entity    text not null,                       -- ledger: primary entity of the angle
  angle_hook      text,
  follow_up_of    bigint references content_items(id), -- declared seriality = dedup bypass
  source_event_id uuid,                                -- consumed SourceEnriched event
  correlation_id  uuid,
  created_at      timestamptz not null default now()
);
create index if not exists content_items_reading_idx
  on content_items (page_id, status, created_at desc);
create index if not exists content_items_angle_idx
  on content_items (page_id, angle_entity, pillar_id, created_at desc);

-- 4. M3 config as data (cooldowns tunable later by Learning, never code constants)
create table if not exists m3_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into m3_config (key, value) values
  ('cooldown_days_default', '14'::jsonb)
on conflict (key) do nothing;

-- Verify:
--   select table_name from information_schema.tables where table_name in
--     ('pillar_catalog','page_pillar_subscriptions','content_items','m3_config');
--   select key, value from m3_config;
--
-- Rollback:
--   drop table if exists content_items;
--   drop table if exists page_pillar_subscriptions;
--   drop table if exists pillar_catalog;
--   drop table if exists m3_config;
