-- RAZ-25 · article reference (RSS mode) — uniqueness guard + budgets + the Hollywood feeds.
-- IDEMPOTENT: safe to run any number of times. (v1 of this file was not — its feed insert had
-- no conflict guard and the table had no unique constraint, so a second run silently created a
-- duplicate row per feed. A duplicate row does NOT double-fetch — buildArticleJobs groups by
-- URL — but it puts the page in the subscribers list twice, and fanOut writes one event per
-- (material x subscriber), so every article would emit TWO identical SourceEnriched events.
-- Caught and cleaned 2026-07-17 before any double-write reached the stream.)
--
-- Three parts, all required for a feed to run:
--   1. the unique index — makes "add a feed" idempotent, matching page_material_sources_uq.
--   2. api_rate_limits — the gate is fail-closed: NO ROW = DENIED. Adding the row IS the
--      approval step for a new host (learnrules). Provider = the URL hostname.
--   3. page_article_sources — which page subscribes to which feed. Adding a feed stays pure
--      config: insert a row, no code change, no redeploy.

-- 1. One subscription per (page, feed). Without this, "insert a feed" is not repeatable.
create unique index if not exists page_article_sources_uq
  on page_article_sources (page_id, url);

-- 2. Budgets. RSS is free and unmetered, so these are generous — they exist to make the call
-- legible in the ledger and stop a broken feed being retried thousands of times, not to ration
-- cost. Records = articles parsed per day (a feed carries ~10-12 items).
insert into api_rate_limits (provider, max_requests_per_day, max_records_per_day, enabled, notes) values
  ('variety.com',               200, 2000, true, 'RAZ-25 Hollywood feed — RSS, free/unmetered'),
  ('www.hollywoodreporter.com', 200, 2000, true, 'RAZ-25 Hollywood feed — RSS, free/unmetered'),
  ('deadline.com',              200, 2000, true, 'RAZ-25 Hollywood feed — RSS, free/unmetered'),
  ('www.indiewire.com',         200, 2000, true, 'RAZ-25 Hollywood feed — RSS, free/unmetered')
on conflict (provider) do nothing;

-- 3. Feeds for the movie page. mode='rss' = parsed in-function; mode='scrape' needs the async
-- web-extractor path and is filtered out by loadArticleRows until that is built.
insert into page_article_sources (page_id, mode, url, enabled) values
  ('mateo', 'rss', 'https://variety.com/feed/',               true),
  ('mateo', 'rss', 'https://www.hollywoodreporter.com/feed/', true),
  ('mateo', 'rss', 'https://deadline.com/feed/',              true),
  ('mateo', 'rss', 'https://www.indiewire.com/feed/',         true)
on conflict (page_id, url) do nothing;

-- Verify (expect exactly 4 rows, no duplicates):
--   select id, page_id, mode, url, enabled from page_article_sources order by id;
--   select page_id, url, count(*) from page_article_sources group by 1,2 having count(*) > 1;
--
-- Rollback:
--   delete from page_article_sources where url like '%variety.com%' or url like '%hollywoodreporter%'
--     or url like '%deadline.com%' or url like '%indiewire.com%';
--   delete from api_rate_limits where provider in
--     ('variety.com','www.hollywoodreporter.com','deadline.com','www.indiewire.com');
--   drop index if exists page_article_sources_uq;
