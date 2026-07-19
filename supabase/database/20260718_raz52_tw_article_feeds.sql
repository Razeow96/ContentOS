-- RAZ-52 · TW article feeds for jello — endpoints verified 2026-07-18.
-- IDEMPOTENT: safe to re-run. Pattern follows 20260717_raz25_article_feeds.sql
-- (page_article_sources_uq unique index already exists from that file).
--
-- Endpoint verification (2026-07-18, direct fetch, browser UA):
--   OK  https://news.ltn.com.tw/rss/entertainment.xml   40 items   自由娛樂
--   OK  https://tw.news.yahoo.com/rss/entertainment     29 items   Yahoo奇摩娛樂
--   OK  https://tw.news.yahoo.com/rss/movies            30 items   Yahoo奇摩電影
--   OK  https://funscreen.tfai.org.tw/rss.xml           10 items   放映週報
--   OK  https://crossing.cw.com.tw/rss                  20 items   換日線 — SITE-WIDE feed
--       (mostly non-movie material; recorded DISABLED until section filtering exists)
--   NO RSS — every candidate 404/403/HTML:
--       chinatimes.com · news.tvbs.com.tw · setn.com · dailyview.tw
--       -> recorded as mode='scrape' DISABLED rows. loadArticleRows filters scrape mode
--          until the async web-extractor path ships; enabled=false makes intent explicit.

-- 1. Page gate: jello emits material (first M2 config for this page)
insert into page_source_settings (page_id, sources_enabled) values ('jello', true)
on conflict (page_id) do nothing;

-- 2. Budgets — the gate is fail-closed: NO ROW = DENIED. Adding the row IS the approval
--    step for a new host (learnrules). Provider = URL hostname. RSS is free/unmetered;
--    limits exist for ledger legibility and to stop a broken feed retrying thousands of times.
insert into api_rate_limits (provider, max_requests_per_day, max_records_per_day, enabled, notes) values
  ('news.ltn.com.tw',       200, 2000, true, 'RAZ-52 TW feed 自由娛樂 — RSS, free/unmetered'),
  ('tw.news.yahoo.com',     200, 2000, true, 'RAZ-52 TW feeds Yahoo奇摩 娛樂+電影 — RSS, free/unmetered'),
  ('funscreen.tfai.org.tw', 200, 2000, true, 'RAZ-52 TW feed 放映週報 — RSS, free/unmetered'),
  ('crossing.cw.com.tw',    200, 2000, true, 'RAZ-52 TW feed 換日線 — RSS; feed row disabled for now')
on conflict (provider) do nothing;

-- 3. Feeds for jello. rss+enabled = live; rss+disabled = recorded candidate;
--    scrape+disabled = no-feed outlet awaiting the web-extractor path.
insert into page_article_sources (page_id, mode, url, enabled) values
  ('jello', 'rss',    'https://news.ltn.com.tw/rss/entertainment.xml',    true),
  ('jello', 'rss',    'https://tw.news.yahoo.com/rss/entertainment',      true),
  ('jello', 'rss',    'https://tw.news.yahoo.com/rss/movies',             true),
  ('jello', 'rss',    'https://funscreen.tfai.org.tw/rss.xml',            true),
  ('jello', 'rss',    'https://crossing.cw.com.tw/rss',                   false),
  ('jello', 'scrape', 'https://www.chinatimes.com/realtimenews/260404/',  false),
  ('jello', 'scrape', 'https://news.tvbs.com.tw/entertainment',           false),
  ('jello', 'scrape', 'https://star.setn.com/',                           false),
  ('jello', 'scrape', 'https://dailyview.tw/',                            false)
on conflict (page_id, url) do nothing;

-- Verify (expect 9 jello rows, 4 enabled rss):
--   select page_id, mode, url, enabled from page_article_sources where page_id='jello' order by id;
--   select page_id, url, count(*) from page_article_sources group by 1,2 having count(*) > 1;
--
-- Rollback:
--   delete from page_article_sources where page_id='jello';
--   delete from api_rate_limits where provider in
--     ('news.ltn.com.tw','tw.news.yahoo.com','funscreen.tfai.org.tw','crossing.cw.com.tw');
--   delete from page_source_settings where page_id='jello';
