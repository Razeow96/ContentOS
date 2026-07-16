# Content OS — Current State (updated 2026-07-14)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear).

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Give copy-paste code blocks; explain at systems level; lean & fast (accept features on sound logic; prod bug-fixes close only on verified outcome).
- **Stack:** GitHub `ContentOS` (owner Razeow96) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`; Postgres + Edge Functions) · Linear (team `Razeow`, project `Content OS`, MCP).
- **My access:** Linear MCP + n8n MCP. Supabase CLI is **linked & authenticated** → I **can** `supabase functions deploy <name>` and read/write **data** via PostgREST (anon/service_role keys from `supabase projects api-keys`). I **cannot** run DDL locally (no psql / DB password) → **ALTER/CREATE TABLE go to the owner as a SQL block to run.** Supabase secrets = owner-only.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream.
- Push delivery: Supabase DB Webhook on INSERT → n8n. Fat, self-contained events.
- Idempotent consumers dedup on event_id (no cursors).
- No secrets in files; use n8n creds / Supabase secrets.
- Legacy Workflows A (Chinese Movie Generator `Sd2dD8Ci9yHhThmG`), B (Poster `RiibWUSoeZgvLs9Q`), C (Daily Report `EPA725LVP3cb3m7a`) stay live, untouched except explicit patches.

## Status by domain

**M0 Infrastructure — COMPLETE.** Backbone live: demo_events, demo_processed, dead_letter, sweep_attempts, content_queue (hardened), event_trace view, hourly safety-sweep. RAZ-6..11 Done.

**M1 Trend Intelligence — functionally complete & live-verified, NOT publishing yet.**
- Edge Function `supabase/functions/m1-trend/` (Deno). Sources: google_trends_daily (rss), youtube (api), youtube_film (api). Config `trendsource.json` + `page_trend_sources` (+ `page_trend_settings` gate). Dedup in `trends`. Emits TrendDetected → `trend_events`. Secret `YOUTUBE_API_KEY` set.
- **Daily Trigger `bZyOyWkgtzj7ucUY` INACTIVE on purpose** — hold M1's schedule OFF until M2 has a live consumer, then publish M1+M2 together. To publish: Header Auth cred on "Run Trend Engine" node + Telegram chat id + activate.
- Done RAZ-12,13,14,15,16,17,30,31. Open **RAZ-18** (verification report — interim posted; needs a multi-day window once M1 is scheduled).

**RAZ-19 Analytics seed — LIVE, In Review.** Workflow `6OZ8xse9mkajn7X7` (active, daily 10:00): content_queue posted rows × page_tokens → FB Graph reactions/comments/shares → `post_metrics`. Backfilled 825. Close after a few days accrual. (FB deprecated post_impressions* → no reach.)

**Legacy patches RAZ-32/33/34 — In Review, VERIFY on a 9AM Workflow A run.** RAZ-32 tmdb_id dedup guard; RAZ-33 salvage JSON parser + dead_letter logging; RAZ-34 TMDB pool 3 pages/list + execute-once.

**M2 Content Sources — actively building; function DEPLOYED & live-tested.**
- M2 = MATERIAL layer (reference data to build posts from). Signals stay in M1 (ADR B7). Incremental strangler.
- **Contract `SourceEnriched v1` APPROVED** (RAZ-20 Done). jsonb payload + `field_map` = field-extensible, no migration. Dedup grain (source, external_id, window_day).
- **SQL foundation live** (`supabase/database/20260713_m2_source_foundation.sql`): source_events, page_source_settings (gate), page_material_sources, page_reference_sources, page_article_sources, source_material (dedup), src_processed (idempotency).
- **Edge function `supabase/functions/m2-contentsource/` DEPLOYED**, 3 modes:
  - `run` — scheduled/trend-driven; page_material_sources → api/rss adapters.
  - `ingest` — n8n hands in already-fetched raw items → normalize → emit (Bright Data harvest / scrape articles).
  - `search` — keyword fan-out; `sink="events"` (autonomous, RAZ-26) or `"manual"` (RAZ-37 isolated store). Optional AI-assist (`ANTHROPIC_API_KEY`, model `claude-opus-4-8`, `service/manuel_search_ai.ts`).
  - Catalog `sources.json`: TMDB (movie_list, trending, search — all live, `TMDB_API_KEY` bearer) + Bright Data family (below) + article_rss/watch_providers scaffolds.
- **TMDB search VERIFIED** (keyword → 20 rows). Note: TMDB search matches **titles** only.
- **Manual AI keyword-search tool (RAZ-37) BUILT + VERIFIED** — n8n two-step form (keyword + AI toggle + per-page checklist grouped by platform) → function `search` sink=manual → `manual_search_results` (isolated: status new→promoted/discarded). Form is active. **Promote bridge** (manual row → SourceEnriched into source_events) still TODO.
- **RAZ-26 Trend Consumer BUILT** — n8n `1gZQvoIfZULhdAiC`: webhook on trend_events → idempotency (src_processed) → function `search` sink=events (keyword=trend topic, correlation/causation carried). Owner to activate: attach `Supabase Edge Fn` cred to its **Enrich** node + wire Supabase DB webhook on `trend_events` → its webhook URL.
- **Bright Data adapter BUILT + partly proven** (`adapters/brightdata.ts`, secret `BRIGHTDATA_API_KEY` set). One config-driven adapter; each platform = one `sources.json` entry (dataset_id + field_map). **OPT-IN** (only runs when named in request `sources`, so default TMDB search stays fast/free). Two families:
  - **AI-search** (`bd_input=prompt`, sync/instant): bd_perplexity, bd_chatgpt, bd_gemini, bd_google_ai, bd_copilot. Ready — need dataset_ids to go live.
  - **Social** (`bd_input=url`, async): bd_facebook … bd_quora (+ snapchat/vimeo/threads disabled, unverified). **Facebook VERIFIED end-to-end** (dataset `gd_lkaxegm826bjpoo9m5`, field_map confirmed against real output; composite engagement mapping added to fieldmap.ts). **Social scrapes are inherently async (minutes) — proven too slow for a sync call, so the sync path fail-fast-guards them.** Social runs via the n8n harvest path only.
- **Per-page cadence:** migration `supabase/database/20260714_m2_reference_schedule.sql` adds `page_reference_sources.harvest_schedule` (`daily`|`on_demand`). **Owner must run it.**
- Open M2: **RAZ-36** (In Progress — Bright Data adapter done; n8n async harvest workflow next), **RAZ-25** (article rss/scrape), **RAZ-24** (listings), **RAZ-38** (SERP/Trends-for-M1 idea, parked Low), **RAZ-35** (future M1 signals, parked Low).

**Database records:** `supabase/database/` = m0_infrastructure.sql, m1_trend.sql, 20260713_m2_source_foundation.sql, m2_manual_search.sql, 20260714_m2_reference_schedule.sql. event_trace view UNIONs trend_events + source_events + demo_events.

## Pending OWNER actions (paused for the day)
1. **Run the SQL** in `20260714_m2_reference_schedule.sql` (harvest_schedule column).
2. **Send one AI-search dataset_id** (start Perplexity) → I wire `bd_perplexity` + redeploy + prove AI-search instant path.
3. **Ongoing dataset collection:** owner screenshots each Bright Data scraper (like `fb1.png`) → screenshot shows dataset_id + input fields + sample output → I wire that catalog entry + tune field_map. No rush; incremental, platform by platform.
4. **Activate RAZ-26:** attach `Supabase Edge Fn` cred to consumer's Enrich node + Supabase DB webhook on trend_events.
5. Attach Bright Data **HTTP header credential** + Supabase Edge Fn cred to the (upcoming) harvest workflow. Optional: rotate the Bright Data token (it appeared in the fb1.png screenshot).
6. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.

## Next build (me)
1. **n8n async harvest workflow (RAZ-36):** Schedule Trigger (nightly, refs where `harvest_schedule='daily'`) + on-demand Webhook (selected refs) → read `page_reference_sources` → Bright Data `/datasets/v3/trigger` → Wait/poll `/progress` → download `/snapshot` → POST function `ingest`. Facebook first.
2. Wire the manual form's page-2 checklist to also emit chosen Bright Data source names into `sources` (so AI/social are selectable in the UI).
3. RAZ-25 article rss (in-function) + scrape; RAZ-24 listings.
4. Promote bridge for manual_search_results.

## Operator how-to
- **Add an M2 source:** reference page → row in `page_reference_sources` (set `platform`, `ref_url`, `harvest_schedule`); article → `page_article_sources`; API material → `page_material_sources`. No redeploy for rows.
- **Add a Bright Data platform:** paste its `dataset_id` into the `bd_*` entry in `sources.json` (from the scraper screenshot), redeploy `m2-contentsource`.
- **Invoke the function (test):** POST `https://qbxpizyemqwcokdkpbqe.supabase.co/functions/v1/m2-contentsource` with anon Bearer; body `{mode,keyword,sink,sources,pages,ai_assist}`. Use `Invoke-RestMethod` + `ConvertTo-Json` (curl.exe mangles nested JSON on Windows).

## Gotchas
- Supabase bundles only imported files — JSON catalogs must be `import x from "./x.json" with { type: "json" }`.
- Bright Data sync `/scrape` DEFERS to async (returns snapshot_id) when slow → social must be n8n-orchestrated async, not in-function.
- Deno not installed locally → type-check happens at `supabase functions deploy` (bundler).
- Postgres index expr must be immutable — dedup uses a STORED generated column.
- FB Graph: post_impressions* insights deprecated.

## AR-1 Admin UI — documented 2026-07-14, BUILD STARTS 2026-07-15 (nothing built yet)
- **AR-1 = additional requirement** (operator UI over the config plane), NOT main ADR-001 scope; unrelated to ADR-001 §A1. Spec doc in Linear: "AR-1 · Admin UI (config plane) — additional requirement" (slug `11bce352561b`).
- **What:** local-only static app `admin/` (index.html + app.js + style.css + gitignored config.js with Supabase key; config.example.js committed). No auth, no deploy — only owner's laptop has the key. Left menu: Trend · Content Source. **Campaign** = UI-level named group of `page_*` config rows (engines unaware); needs one migration: `campaign text` column on page_trend_sources / page_material_sources / page_reference_sources / page_article_sources. No M1/M2 logic changes (except tiny read-only `catalog` mode on m2-contentsource in v2).
- **RAZ-39 (Backlog)** = v1: campaign-column SQL block (owner runs) + shell + Trend screen (campaign CRUD → page_trend_sources; per-platform honest fields — google_trends_daily geo-only; trends_enabled gates; read-only trends feed).
- **RAZ-40 (Backlog, blocked by RAZ-39)** = v2: `catalog` mode + adapter board (~17 entries, deployed truth) + 3 campaign tabs (material/reference/article tables) + sources_enabled gates + run-now (mode=search POST; RAZ-36 harvest webhook when it exists).
- **Resume tomorrow:** start RAZ-39 — hand owner the campaign-column SQL block, then build the Trend screen.
