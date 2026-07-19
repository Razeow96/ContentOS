-- RAZ-57 · Character Brain v1 — identity settings (M3-owned config module).
-- IDEMPOTENT: safe to re-run. Method 1: the field catalog drives everything —
-- UI form, Q&A interview, validation, and the prompt renderer are all renderings
-- of char_field_catalog. Adding a creation field = one catalog row.
--
-- Boundary (ADR B6): config catalog consumed by M3 at prompt-assembly. No new
-- domain, no events, no stream. Only bridge to Content-OS = page_character_subscriptions.
-- Portability: zero FKs into domain tables; memory references are loose text hashes.
--
-- Precedence rules (recorded in RAZ-57):
--   page hard rules > character language settings;
--   mild_badword injection only at slang_level >= high AND pillar register allows.

-- ============================================================================
-- 1. Field catalog — every creation field as data
-- ============================================================================
create table if not exists char_field_catalog (
  field          text primary key,
  grp            text not null,             -- profile | personality | language | memory | state
  input_type     text not null check (input_type in
                   ('text','number','textarea','enum','multi_select','text_list')),
  required       boolean not null default true,
  constraints    jsonb not null default '{}'::jsonb,   -- {min_picks,max_picks,max_items,max_chars,...}
  options_source text,                      -- 'char_trait_catalog' | 'inline' | null
  options_inline jsonb,                     -- for enum: allowed values in order
  question       text,                      -- the Q&A interview question (Method 3 rides free)
  renderer_bands jsonb,                     -- band -> prompt phrase (models read words, not enums)
  sort_order     int not null default 100
);

-- ============================================================================
-- 2. DISC trait catalog — 40 traits, owner's list (2026-07-19)
-- ============================================================================
create table if not exists char_trait_catalog (
  trait    text primary key,
  quadrant char(1) not null check (quadrant in ('D','I','S','C'))
);

insert into char_trait_catalog (trait, quadrant) values
  ('direct','D'),('decisive','D'),('assertive','D'),('challenging','D'),
  ('results_oriented','D'),('fast_paced','D'),('straightforward','D'),
  ('confident','D'),('competitive','D'),('action_first','D'),
  ('enthusiastic','I'),('encouraging','I'),('storytelling','I'),('persuasive','I'),
  ('friendly','I'),('humorous','I'),('energetic','I'),('expressive','I'),
  ('engaging','I'),('optimistic','I'),
  ('calm','S'),('patient','S'),('empathetic','S'),('supportive','S'),
  ('reassuring','S'),('good_listener','S'),('cooperative','S'),('consistent','S'),
  ('gentle','S'),('thoughtful','S'),
  ('analytical','C'),('logical','C'),('structured','C'),('precise','C'),
  ('detail_oriented','C'),('evidence_based','C'),('systematic','C'),('careful','C'),
  ('objective','C'),('methodical','C')
on conflict (trait) do nothing;

-- ============================================================================
-- 3. Lexicons — three shared categories, owner's curated lists (2026-07-19).
--    Shared across ALL characters; per-character slang_level governs injection.
-- ============================================================================
create table if not exists char_lexicons (
  id      bigint generated always as identity primary key,
  kind    text not null check (kind in ('shortform','mild_badword','localizer')),
  token   text not null,
  meaning text,                              -- shortforms carry meanings; others null
  note    text,                              -- e.g. use-with-caution flags
  unique (kind, token)
);

insert into char_lexicons (kind, token, meaning) values
  ('shortform','ㄏㄏ','哈哈'),('shortform','XD','大笑'),('shortform','XDD','爆笑'),
  ('shortform','QQ','難過'),('shortform','Orz','認輸'),('shortform','88','掰掰'),
  ('shortform','掰','掰掰'),('shortform','3Q','謝謝'),('shortform','BJ4','不解釋'),
  ('shortform','484','是不是'),('shortform','87','白癡（諧音）'),('shortform','94','就是'),
  ('shortform','886','掰掰囉'),('shortform','555','嗚嗚嗚'),('shortform','666','很厲害'),
  ('shortform','==','無言'),('shortform','...','省略'),('shortform','餒','呢'),
  ('shortform','蛤','什麼？'),('shortform','齁','表示情緒'),('shortform','欸','引起注意'),
  ('shortform','耶','開心'),('shortform','喔','語尾'),('shortform','唷','語尾'),
  ('shortform','ㄟ','欸'),('shortform','安安','哈囉'),('shortform','早安安','早安'),
  ('shortform','晚安安','晚安'),('shortform','水啦','很棒'),('shortform','讚啦','很讚'),
  ('shortform','可','可以'),('shortform','不OK','不行'),('shortform','OK啦','可以'),
  ('shortform','先閃','先離開'),('shortform','收工','完成'),('shortform','衝','開始做'),
  ('shortform','穩','沒問題'),('shortform','有料','很有實力'),('shortform','很頂','很棒'),
  ('shortform','神','非常厲害'),('shortform','雷','很差'),('shortform','哭啊','很慘'),
  ('shortform','笑死','非常好笑'),('shortform','社死','社會性死亡'),
  ('shortform','暈船','喜歡上對方'),('shortform','破防','心態崩了')
on conflict (kind, token) do nothing;

insert into char_lexicons (kind, token, note) values
  ('mild_badword','靠',null),('mild_badword','靠啦',null),('mild_badword','靠喔',null),
  ('mild_badword','靠欸',null),('mild_badword','靠北',null),('mild_badword','靠邀',null),
  ('mild_badword','北七',null),('mild_badword','白目',null),('mild_badword','機車',null),
  ('mild_badword','三八',null),('mild_badword','白癡',null),('mild_badword','笨蛋',null),
  ('mild_badword','豬頭',null),('mild_badword','呆子',null),('mild_badword','傻眼',null),
  ('mild_badword','智障','use with caution — owner flag 慎用'),
  ('mild_badword','欠揍',null),('mild_badword','搞屁',null),('mild_badword','搞什麼',null),
  ('mild_badword','衝三小',null),('mild_badword','蝦毀',null),('mild_badword','瞎爆',null),
  ('mild_badword','扯爆',null),('mild_badword','有病喔',null),('mild_badword','瘋了喔',null),
  ('mild_badword','你很鬧',null),('mild_badword','很鬧欸',null),('mild_badword','超煩',null),
  ('mild_badword','煩死',null),('mild_badword','氣死',null),('mild_badword','無言',null),
  ('mild_badword','吐血',null),('mild_badword','哭啊',null),('mild_badword','笑死',null),
  ('mild_badword','誇張欸',null),('mild_badword','太扯',null),('mild_badword','什麼鬼',null),
  ('mild_badword','鬼扯',null),('mild_badword','瞎扯',null),('mild_badword','亂講',null),
  ('mild_badword','別鬧',null),('mild_badword','神經喔',null),('mild_badword','有夠雷',null),
  ('mild_badword','雷爆',null),('mild_badword','雷死',null),('mild_badword','廢欸',null),
  ('mild_badword','廢到笑',null),('mild_badword','搞笑喔',null),('mild_badword','傻爆眼',null),
  ('mild_badword','有夠白目',null)
on conflict (kind, token) do nothing;

insert into char_lexicons (kind, token) values
  ('localizer','欸'),('localizer','啊'),('localizer','嗯'),('localizer','那個'),
  ('localizer','就是'),('localizer','其實'),('localizer','然後'),('localizer','所以'),
  ('localizer','對啊'),('localizer','對啦'),('localizer','真的'),('localizer','真的啦'),
  ('localizer','好啦'),('localizer','可以啦'),('localizer','還好啦'),('localizer','欸不是'),
  ('localizer','你知道嗎'),('localizer','老實說'),('localizer','說真的'),('localizer','基本上'),
  ('localizer','感覺啦'),('localizer','我覺得'),('localizer','應該吧'),('localizer','可能吧'),
  ('localizer','還行'),('localizer','不錯啦'),('localizer','算是'),('localizer','大概'),
  ('localizer','有點'),('localizer','稍微'),('localizer','蠻'),('localizer','超'),
  ('localizer','有夠'),('localizer','真的欸'),('localizer','不是啦'),('localizer','先等等'),
  ('localizer','等等喔'),('localizer','OK啦'),('localizer','沒事啦'),('localizer','放心啦')
on conflict (kind, token) do nothing;

-- ============================================================================
-- 4. Characters — trimmed v1 (owner decision: no values/attention/decision matrices)
-- ============================================================================
create table if not exists characters (
  id                bigint generated always as identity primary key,
  char_key          text not null,          -- stable slug, e.g. 'jello'
  version           int  not null default 1,
  name              text not null,
  display_name      text,
  gender            text,
  age               int,
  birth_place       text,
  current_city      text,
  education         text,
  disc_picks        text[] not null
                    check (array_length(disc_picks,1) between 5 and 10),
  speaking_language text not null default 'zh-TW',
  slang_level       text not null default 'low'
                    check (slang_level in ('none','low','medium','high','extreme')),
  voice_tone_energy text not null default 'low'
                    check (voice_tone_energy in ('low','medium','high','very_high')),
  background_story  text check (char_length(background_story) <= 1200),  -- ≈300 words
  skills            text[] check (skills is null or array_length(skills,1) <= 3),
  interests         text[] check (interests is null or array_length(interests,1) <= 3),
  is_template       boolean not null default false,   -- Method 2: clone source
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (char_key, version)
);

-- disc_picks validity vs the trait catalog (array FK doesn't exist in PG — trigger)
create or replace function char_validate_disc() returns trigger
language plpgsql as $$
declare bad text;
begin
  select t into bad from unnest(new.disc_picks) as t
   where not exists (select 1 from char_trait_catalog c where c.trait = t) limit 1;
  if bad is not null then
    raise exception 'disc_picks contains unknown trait: %', bad;
  end if;
  return new;
end $$;
drop trigger if exists characters_validate_disc on characters;
create trigger characters_validate_disc
  before insert or update on characters
  for each row execute function char_validate_disc();

-- ============================================================================
-- 5. Current state — history rows; latest = current. The variance driver.
-- ============================================================================
create table if not exists char_current_state (
  id         bigint generated always as identity primary key,
  char_key   text not null,
  mood       text not null check (mood in ('low','medium','high','very_high')),
  note       text check (note is null or char_length(note) <= 200),
  changed_by text not null default 'manual' check (changed_by in ('manual','signal','decay')),
  created_at timestamptz not null default now()
);
create index if not exists char_current_state_latest_idx
  on char_current_state (char_key, created_at desc);

-- ============================================================================
-- 6. The only bridge to Content-OS: page subscription (one active per page)
-- ============================================================================
create table if not exists page_character_subscriptions (
  id         bigint generated always as identity primary key,
  page_id    text not null,
  char_key   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists page_character_active_uq
  on page_character_subscriptions (page_id) where active;

-- ============================================================================
-- 7. Field catalog seed — the creation flow as data (question = Method 3 interview)
-- ============================================================================
insert into char_field_catalog
  (field, grp, input_type, required, constraints, options_source, options_inline, question, renderer_bands, sort_order)
values
  ('name','profile','text',true,'{"max_chars":80}',null,null,
   'What is their full name?',null,10),
  ('display_name','profile','text',false,'{"max_chars":80}',null,null,
   'What do friends/followers actually call them?',null,11),
  ('gender','profile','text',false,'{}',null,null,'Gender?',null,12),
  ('age','profile','number',false,'{"min":13,"max":90}',null,null,'How old are they?',null,13),
  ('birth_place','profile','text',false,'{}',null,null,'Where were they born?',null,14),
  ('current_city','profile','text',false,'{}',null,null,'Where do they live now?',null,15),
  ('education','profile','text',false,'{}',null,null,'Education background?',null,16),
  ('disc_picks','personality','multi_select',true,'{"min_picks":5,"max_picks":10}',
   'char_trait_catalog',null,
   'Pick the 5–10 words people who know them would use to describe them.',null,20),
  ('speaking_language','language','text',true,'{}',null,null,
   'What language do they speak/write in?',null,30),
  ('slang_level','language','enum',true,'{}',null,
   '["none","low","medium","high","extreme"]',
   'How street is their texting — none, a little, or full internet-native?',
   '{"none":"writes clean, standard sentences; no internet slang or short forms",
     "low":"mostly standard writing; at most one light localizer word or short form per post",
     "medium":"comfortable internet-native tone; a few short forms and localizer words per post where natural",
     "high":"heavy internet-native voice; short forms and localizer words flow freely; mild attitude words allowed when the register fits",
     "extreme":"full street register; short forms, localizers and mild attitude words are part of every breath — still never forced"}',31),
  ('voice_tone_energy','language','enum',true,'{}',null,
   '["low","medium","high","very_high"]',
   'Are they the loud friend or the quiet friend?',
   '{"low":"quiet, calm delivery; understates rather than exclaims",
     "medium":"relaxed conversational energy; animated only when something earns it",
     "high":"energetic and expressive; quick rhythms, lively reactions",
     "very_high":"maximum hype; big reactions, momentum in every line — yet never fake"}',32),
  ('background_story','memory','textarea',true,'{"max_chars":1200}',null,null,
   'Tell their life story in one paragraph (up to ~300 words).',null,40),
  ('skills','memory','text_list',false,'{"max_items":3}',null,null,
   'Three things they are actually good at (titles only).',null,41),
  ('interests','memory','text_list',false,'{"max_items":3}',null,null,
   'Three things they cannot shut up about (titles only).',null,42),
  ('current_mood','state','enum',true,'{}',null,
   '["low","medium","high","very_high"]',
   null,  -- runtime field, not part of the creation interview
   '{"low":"a little flat and quiet today; shorter sentences, softer takes",
     "medium":"an ordinary day; natural baseline voice",
     "high":"in a good mood; a bit more playful and generous than usual",
     "very_high":"genuinely excited today; lets it show, within character"}',50)
on conflict (field) do nothing;

-- Verify:
--   select count(*) from char_trait_catalog;                       -- 40
--   select kind, count(*) from char_lexicons group by kind;        -- shortform 46 / mild_badword 50 / localizer 40
--   select count(*) from char_field_catalog;                       -- 15
-- Rollback:
--   drop table if exists page_character_subscriptions, char_current_state, characters,
--     char_lexicons, char_trait_catalog, char_field_catalog cascade;
--   drop function if exists char_validate_disc();
