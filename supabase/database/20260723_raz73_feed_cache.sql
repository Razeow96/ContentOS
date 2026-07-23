-- RAZ-73 · feed_cache — M2-owned state table (like source_material).
-- A campaign burst fires one trendConsume per trend; each re-fetched the same
-- page feeds and 50 trends × 2 Yahoo feeds blew the host's 2000/day record
-- budget (proven 2026-07-23). Raw feed items are cached here and reused across
-- the burst (TTL = sources.json trend_pull.feed_cache_ttl_min).
create table if not exists feed_cache (
  url        text primary key,
  fetched_at timestamptz not null default now(),
  items      jsonb not null default '[]'::jsonb
);

comment on table feed_cache is
  'RAZ-73: raw feed/scrape items cached per URL for the trend-compile burst. TTL enforced in code (trend_pull.feed_cache_ttl_min); rows are overwritten on refetch.';
