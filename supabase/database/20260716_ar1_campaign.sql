-- AR-1 · Admin UI — campaign grouping (RAZ-39)
-- A campaign is a UI-LEVEL named group of config rows: one row per selected page,
-- all tagged with the same name. The engines never read it — M1/M2 keep resolving
-- config exactly as they do today, so this is additive and changes no behaviour.
-- Nullable on purpose: rows that predate campaigns stay valid and show as
-- "Ungrouped" in the admin UI rather than being force-grouped by a guess.

alter table page_trend_sources     add column if not exists campaign text;
alter table page_material_sources  add column if not exists campaign text;
alter table page_reference_sources add column if not exists campaign text;
alter table page_article_sources   add column if not exists campaign text;

comment on column page_trend_sources.campaign is
  'AR-1 UI grouping only — engines ignore it. Null = ungrouped. (RAZ-39)';
comment on column page_material_sources.campaign is
  'AR-1 UI grouping only — engines ignore it. Null = ungrouped. (RAZ-39)';
comment on column page_reference_sources.campaign is
  'AR-1 UI grouping only — engines ignore it. Null = ungrouped. (RAZ-39)';
comment on column page_article_sources.campaign is
  'AR-1 UI grouping only — engines ignore it. Null = ungrouped. (RAZ-39)';

-- The admin UI lists and edits campaigns by name, and saving replaces a campaign's
-- rows wholesale (delete where campaign = $1, then insert), so every read and write
-- filters on this column.
create index if not exists idx_page_trend_sources_campaign     on page_trend_sources (campaign);
create index if not exists idx_page_material_sources_campaign  on page_material_sources (campaign);
create index if not exists idx_page_reference_sources_campaign on page_reference_sources (campaign);
create index if not exists idx_page_article_sources_campaign   on page_article_sources (campaign);
