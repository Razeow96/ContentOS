# Content OS — Current State (updated 2026-07-17)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `claude.md` (read both at session start).

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Give copy-paste code blocks; explain at systems level; lean & fast.
- **Go-live is HIS call, on his timeline.** Activation · publishing · cutover · migration · commits are NOT tasks and NOT blockers — state a prerequisite once in its Linear issue, then drop it. "What's remaining?" is a STATUS question; we are still building. No urgency language. (Codified in claude.md → Build philosophy 2026-07-17 after I pushed activation 4x in one session.)
- **He commits himself**, once per completed session. Never remind him.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **repo is PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP live = Web Unlocker/SERP only, NO dataset tools).
- **My access:** Linear + n8n MCP. Supabase CLI linked → `supabase functions deploy` + read/write data via PostgREST. **I CAN run SQL incl. DDL** — n8n Postgres node on the `Postgres account` credential (`J2c18reEy5dzvP1n`); `executeQuery` takes a whole multi-statement migration. The migration file in `supabase/database/` is still the deliverable: write it, make it idempotent, **run it myself**, verify the effect. Never hand over "go run this". I **cannot write n8n credential secrets**.
- **Testing n8n:** `execute_workflow` (manual). Only ONE trigger can be enabled per workflow — it fires the first one, so disable the others.
- **Browser-verify the admin UI**: playwright + a static server at the REPO ROOT (`scratchpad/serve.js`, `drive.js`). Screens are not verified until clicked.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. Push delivery (DB webhook → n8n). Fat events. Idempotent consumers dedup on event_id.
- **Every outbound API call passes the rate-limit gate first.** No raw `fetch()` in adapters, no raw calls from n8n. **No row in `api_rate_limits` = DENIED** — adding the row IS the approval for a new host.
- No secrets in files. Legacy Workflows A (`Sd2dD8Ci9yHhThmG`), B (`RiibWUSoeZgvLs9Q`), C (`EPA725LVP3cb3m7a`) stay live and untouched.

## ▶ RESUME HERE

**M2 is 7/10 Done.** Everything below is built + verified; nothing is blocked on Raze.

**Next buildable:** **RAZ-40** (In Progress) — the CONFIG half of the admin Content Source screen: adapter board (deployed catalog as truth), 3 campaign tabs (`page_material_sources` · `page_reference_sources` · `page_article_sources`), `sources_enabled` gates, run-now. The search+review half shipped today.

**Also open:** RAZ-24 (watch providers — scope confirmed **providers only**; "now-showing" was already delivered by RAZ-23. Endpoint is per-movie + country-keyed, so it must hang off movie material, not run standalone). RAZ-39 (In Review — Trend screen READ verified in browser; the campaign WRITE path never exercised, and `saveCampaign` does DELETE-then-INSERT so a bug there deletes real M1 config).

**Deferred by owner:** RAZ-21 → wait for M3. RAZ-27 (cutover) → after M3, after he operates `/admin` himself for days. Do not raise either.

## Status by domain

**M0 Infrastructure — COMPLETE (RAZ-42 Done 2026-07-17).**
Backbone: demo_events, dead_letter, sweep_attempts, content_queue, event_trace view, hourly sweep. Rate-limit gate `supabase/functions/m0-infrastructure/` — `guardedFetch` for edge fns + a gate endpoint for n8n. Fail-closed, proven: a full day of BD traffic (20 req / 90 records) reconciled; deny path proven with `Trigger Scrape` never firing.

**M1 Trend Intelligence — live, NOT publishing.** `m1-trend` edge fn; sources google_trends_daily, youtube, youtube_film; 3 pages (mateo, jello_topmovie_svs, daily_movie_edc). Daily Trigger `bZyOyWkgtzj7ucUY` INACTIVE **on purpose** — owner's call, don't raise. Open: RAZ-18, RAZ-28, RAZ-35, RAZ-38.

**M2 Content Sources — 7/10 Done.**
- `m2-contentsource` modes: `run` · `ingest` · `search` · **`search_plan`** · `harvest_plan` · **`promote`**. CORS enabled (the admin UI is a browser caller). Bad input = **400** (`BadRequest`), real failures = 500.
- **All 8 harvest platforms field_map VERIFIED against real payloads** (facebook 30 · linkedin 10 · youtube 10 · reddit 10 · tiktok 10 · instagram 11 · pinterest 9 · x 10).
- **Keyword search: 4 of 8 platforms** — youtube · tiktok · reddit · pinterest. The other 4 have NO keyword discovery in BD (platform limit, not a gap).
- **Articles (RAZ-25):** 4 Hollywood RSS feeds live (variety · hollywoodreporter · deadline · indiewire) + scrape mode via BD Web Unlocker + Open Graph.
- Snapchat + vimeo **hard-deleted** 2026-07-17 (owner).

**AR-1 Admin UI** — `admin/` static app. **Run: static server at the REPO ROOT**, open `/admin/`. Needs service_role in gitignored `admin/config.js` (+ `HARVEST_WORKER_URL`). Screens: Trend · **Content Source (search + review, browser-verified)** · Infrastructure.
Static (not Next.js) is a RECORDED decision (RAZ-39: "local-only, no deploy, no auth") — service_role lives in the browser, which is only OK because it is never deployed. Trigger to revisit: the day it needs hosting or a second user.

**RAZ-19** In Review (close after post_metrics accrual). **RAZ-32/33/34** In Review — need a 9AM Workflow A run to verify.

## n8n workflows
- **`2IuURyFgPsYW8wIw` M2 · Harvest Dispatcher** — 06:00 schedule + `/webhook/m2-reference-harvest` (`{ref_ids:[..]}`).
- **`g358gDdwFoHjeCSL` M2 · Harvest Worker** — ONE execution per job: `Job In → Rate Limit Gate → Gate Allowed? → Trigger → Wait 60s → Poll → Ready? → Download → Ingest`. Giveup after 25 polls → **Cancel Snapshot** → `Ended Without Data`. **Serves BOTH plans** — it holds no config, only echoes job fields: `harvest_plan` (ref-shaped) → source_events; `search_plan` (keyword-shaped) → ingest `sink=manual` → manual_search_results.
- **`1gZQvoIfZULhdAiC` M2 · Trend Consumer (RAZ-26)** — **ACTIVE**. DB trigger on `trend_events` INSERT → idempotency guard → `First Delivery?` → Enrich.
- **`iajXVmJEhE73y9n5` ZZ · BD Probe + SQL Runner (temp)** — 2 branches: BD payload probe + a Postgres SQL runner. Delete when quora/threads are settled.
- Harvest workflows inactive. Creds: `Bright Data Key`, `Supabase Key`, `Postgres account`.

## Pending OWNER actions
1. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.
2. Optional: quora + threads dataset_ids (both `gd_REPLACE`, self-skip, nothing blocked).

## Database records (`supabase/database/`)
m0_infrastructure · m1_trend · 20260713_m2_source_foundation · m2_manual_search · 20260714_m2_reference_schedule · 20260716_ar1_campaign · 20260716_m0_rate_limit · **20260717_raz26_trend_events_webhook** · **20260717_raz25_article_feeds** — all applied.

## Gotchas (hard-won)
- **BD bills per RECORD and keeps collecting after you stop polling.** ALWAYS `limit_per_input`; ALWAYS cancel on giveup. "Still running at timeout" = unbounded spec, NOT a slow platform.
- **A BD probe is free ONLY while the payload is INVALID** — omit a required field. The required field differs per discovery type (`url` | `keyword` | `keyword_search`). The probe fires raw HTTP and **bypasses the rate-limit gate**; real calls go on the gated path.
- **DISCOVER jobs are async-only.** Measured: keyword discover = 112.6s with `dataset_size: 0`. Only `bd_input=prompt` (AI-search, 19–78s) survives sync.
- **THE SAME DATASET RETURNS A DIFFERENT SHAPE PER DISCOVERY MODE.** pinterest profile-discovery has `title` 9/9; keyword-discovery has **no `title` key at all** → the inherited map dropped all 7 records while reporting `ok:true`. A search entry may NOT inherit its harvester's field_map on faith.
- **Every field_map has been wrong the same way**: `title` → the account/page name (1-distinct); keys that don't exist (0/N). No platform has a nested `engagement` object — all flat. views/plays/bookmarks stay OUT of engagement (it's summed for `best_performing`).
- **XML/RSS `<guid isPermaLink="false">` parses to an OBJECT** `{#text, @isPermaLink}` — mapping it as a plain path gives `[object Object]` on every item → 1 dedup key → the feed emits 1 article/day, silently. Use the fallback chain.
- **`field_map` values may be a FALLBACK CHAIN** (`["images.0","video_thumbnail"]`, first non-empty wins) — for platforms that split one concept across post types. `Array.isArray` must be checked BEFORE the object branches.
- **`fillUrl` encodeURIComponents every `{placeholder}`** — right for a query param, fatal for a whole URL. Feed/page URLs are assigned directly, never templated.
- **BD enums are CAPITALIZED** (`New`/`Hot`/`Top`, `Latest`/`Popular`, `Video`/`Shorts`, `All time`). Lowercase is rejected.
- **n8n Postgres `RETURNING` + `ON CONFLICT DO NOTHING` cannot gate anything** — the node emits `{success:true}` (one item), not zero, on no rows. Always follow with an explicit IF on the returned column. (This silently defeated RAZ-8's idempotency.)
- **n8n `addNode` has no `executeOnce`** — the node then runs once PER INPUT ITEM (wrote 70 rows instead of 7).
- **n8n silently falls back to the first credential of a matching type** when none is attached → confusing 401s. Attach explicitly.
- **n8n only flushes execution data at the END** — poll the DB instead.
- Supabase bundles only *imported* files — JSON catalogs need `with { type: "json" }`. Deno not installed locally; type-check happens at deploy. **Validate `sources.json` parses BEFORE deploy.**
- **PowerShell 5.1 `ConvertTo-Json` emits INVALID JSON** on emoji. Use node's `JSON.stringify` + `[System.IO.File]::WriteAllText`. PS also chokes on inline node `-e` with braces/quotes — write a file to scratchpad instead.
- Git is not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe` (glob for newest).
- 40 `tmdb_*` events + 1 `bd_snapchat` event in `source_events` are harmless. **Leave them** — append-only.

## Repo state
Working tree clean at Raze's last push (`7679356`). Uncommitted since: promote mode · admin Content Source screen · CORS/400 · article adapter (RSS + scrape) · keyword search ×3 platforms · fallback chains · 2 SQL files. **He commits himself.**
