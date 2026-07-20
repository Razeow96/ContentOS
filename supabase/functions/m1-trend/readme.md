# m1-trend Edge Function — AI + human brief

> **AI: read this fully before editing anything.** You have no memory of prior sessions. This is your complete context for the Content OS Trend Intelligence service. Follow the rules; if a request conflicts with them, follow the rules and say so.

## What this is
A Supabase Edge Function (Deno/TypeScript) that is the **Trend Intelligence domain** of Content OS. Daily, it pulls "what's trending" from external platforms, normalizes each signal, dedups it, and writes `TrendDetected` events into the `trend_events` SQL stream. That INSERT fires a Supabase webhook that fans out to downstream domains. n8n only *triggers* this function and reports the summary — n8n never touches trend data.

## The person
Raze is a system architect / founder, **not a coder**. Explain at a systems level; give complete, ready-to-paste code; do not explain where to click. Build lean — smallest correct change, no over-engineering, no speculative features.

## Golden rules (never break)
1. **Config is data, not code.** Platform definitions live in `trend/trendsource.json` (GitHub). Page subscriptions live in the `page_trend_sources` SQL table. This function READS them — never hardcode a platform, a page, or a key here.
2. **No secrets in code.** API keys come from Supabase secrets (`Deno.env.get`). `auth_ref` in a source names the env var. Never write a key into a file.
3. **The domain owns its writes.** This function writes only to `trend_events` (and the `trends` dedup table). It never reads or writes another domain's tables. Events only across domains (ADR-001).
4. **Output shape is fixed by contract.** The `TrendDetected` payload must match the Linear "TrendDetected" contract (RAZ-12). Fields: raw_trend_id, page, campaign, source, adapter_type, timeframe, topic, description, category, keywords, region, country, language, volume{value,unit,source}, rank, signal_type, image_url, related, external_id, url, detected_at, raw. `topic`, `page`, `source`, `raw_trend_id`, `detected_at` are required. `campaign` (nullable) was added in **schema_version 2** (additive) so the admin can attribute an event to its operator grouping.
5. **Volume is never comparable across platforms.** Store {value, unit, source}. No normalizing views vs searches vs likes — that's a later Analytics job.

## File map
- `index.ts` — entry point. Orchestration only: load config -> build jobs -> run adapters -> normalize -> dedup -> fan out -> write -> return summary. **Must stay at function root** (Supabase requirement).
- `deno.json` — imports/config (root).
- `adapters/rss.ts | api.ts | scraper.ts` — the 3 skeletons. Each takes a PullJob, returns raw platform items. `rss` and `api` are generic (config-driven). `scraper` is the ONLY place per-source code is allowed.
- `config/config.ts` — loads trendsource.json + subscriptions, builds pull jobs (fills url placeholders, groups subscribers).
- `config/fieldmap.ts` — getPath + mapField: apply a source's field_map to one item.
- `config/dedup.ts` — filterFresh: enforce the freshness invariant against the `trends` table.
- `service/normalize.ts` — normalize (items -> RawTrend[]) and fanOut (RawTrend -> one TrendDetected per subscribing page).
- `service/writer.ts` — writeTrendEvents: POST events into trend_events via PostgREST.
- `service/types.ts` — all shared types. If you change the trend shape, change it here and keep it matching the contract.

## How to add a platform (the whole point)
- API or RSS: add one object to `trend/trendsource.json` (name, type, url with {placeholders}, field_map, defaults). NO code change here.
- Different response SHAPE or timeframe: a NEW source object (e.g. `youtube_shorts`, `google_trends_weekly`), not a placeholder.
- Scrape with HTML: add extraction logic in `adapters/scraper.ts` for that source only.
- Never verify by guessing endpoints — if unsure, leave the source `enabled:false` with a CONFIRM note.

## Env vars the function expects
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected by Supabase.
- `TRENDSOURCE_URL` — raw GitHub URL of trendsource.json (or bundle it).
- One per keyed source, named by `auth_ref` uppercased with underscores (e.g. `YOUTUBE_API_KEY` for auth_ref "YouTube API key").

## Deploy / run
- `supabase functions deploy m1-trend`
- `supabase secrets set YOUTUBE_API_KEY=...`
- Invoke the function URL to run once; check rows in `trend_events`.
- Do NOT touch the legacy n8n workflows (Chinese Movie Generator / Poster / Daily Report).

## What must NOT happen
- No page names, no secrets, no hardcoded platforms in this code.
- No writing to other domains' tables.
- No cross-platform volume normalization.
- No output that deviates from the TrendDetected v1 contract.
- No over-engineering. Lean and fast.
