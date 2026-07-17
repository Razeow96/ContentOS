# Content OS — Current State (updated 2026-07-17, end of evening session)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `claude.md` (read both at session start — **both changed 2026-07-17**, see "Rule files changed" below).

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Give copy-paste code blocks; explain at systems level; lean & fast.
- **Acceptance standard (changed 2026-07-17):** a feature is accepted ONLY after its main path ran once for real with the result observed. That single proven run = Done. No edge-case hunting beyond it. Mark Done in Linear immediately — never wait for (or mention) his commit; he commits himself, once per session.
- **Go-live is HIS call, on his timeline.** Activation · publishing · cutover · migration are NOT tasks and NOT blockers — state a prerequisite once in its Linear issue, then drop it.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **repo is PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP live = Web Unlocker/SERP only, NO dataset tools).
- **My access:** Linear + n8n MCP. Supabase CLI linked → `supabase functions deploy` + read/write data via PostgREST. **I CAN run SQL incl. DDL** — n8n Postgres node on the `Postgres account` credential (`J2c18reEy5dzvP1n`); `executeQuery` takes a whole multi-statement migration. The migration file in `supabase/database/` is still the deliverable: write it, make it idempotent, **run it myself**, verify the effect. I **cannot write n8n credential secrets**.
- **Testing n8n:** `execute_workflow` (manual). Only ONE trigger can be enabled per workflow — it fires the first one, so disable the others.
- **Browser-verify the admin UI:** playwright + static server at the REPO ROOT. Playwright node_modules lives in old scratchpad `Temp\claude\C--Users-laptop-Documents-GitHub-ContentOS\07ae2937-…\scratchpad\node_modules` (browsers in `%LOCALAPPDATA%\ms-playwright`) — require it by absolute path from a new scratchpad. Screens are not verified until clicked.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. Push delivery (DB webhook → n8n) BETWEEN domains — polling a vendor that can't push (BD snapshot status) is normal and lives ONLY in the n8n Harvest Worker. Fat events. Idempotent consumers dedup on event_id.
- **Every outbound API call passes the rate-limit gate first.** No raw `fetch()` in adapters. **No row in `api_rate_limits` = DENIED.** ONE exception: the BD schema probe (deliberately-invalid payload = free, rejected pre-crawl); valid payloads never go raw.
- **UI renders what the backend serves — never re-implements backend predicates/enums** (a guessed `bd_input` value hid 4 platforms; codified in claude.md).
- No secrets in files. Legacy Workflows A (`Sd2dD8Ci9yHhThmG`), B (`RiibWUSoeZgvLs9Q`), C (`EPA725LVP3cb3m7a`) stay live and untouched.

## ▶ RESUME HERE

**M2 is 8/10 Done — build work complete.** RAZ-24 (watch providers) shipped + live-verified this evening. Remaining M2 is not buildable now: RAZ-21 waits for M3 (webhook needs a consumer to exist), RAZ-27 (cutover) is owner-deferred until after M3. Do not raise either.

**Next buildable, pick one:**
1. **RAZ-40** (In Progress) — the CONFIG half of the admin Content Source screen: adapter board (deployed catalog as truth), 3 campaign tabs (`page_material_sources` · `page_reference_sources` · `page_article_sources`), `sources_enabled` gates, run-now. The search+review half shipped 2026-07-17 and was hardened by the full review (below).
2. **Start M3 Content Generation** — also unblocks RAZ-21 as its first deliverable.

**RAZ-39 In Review** — Trend screen READ verified in browser. The campaign WRITE path is still unexercised live; the destroy-real-config risk is gone (saveCampaign is now insert-first + locked, see review), but one real save is still needed to close.

## Status by domain

**M0 Infrastructure — COMPLETE** (RAZ-42 Done). Backbone: demo_events, dead_letter, sweep_attempts, content_queue, event_trace view, hourly sweep. Rate-limit gate `supabase/functions/m0-infrastructure/` — `guardedFetch` for edge fns + a gate endpoint for n8n. Fail-closed, proven.

**M1 Trend Intelligence — live, NOT publishing.** `m1-trend` edge fn; sources google_trends_daily, youtube, youtube_film; 3 pages (mateo, jello_topmovie_svs, daily_movie_edc). Daily Trigger `bZyOyWkgtzj7ucUY` INACTIVE on purpose — owner's call. Open: RAZ-18, RAZ-28, RAZ-35, RAZ-38.

**M2 Content Sources — 8/10 Done (RAZ-21 → M3 · RAZ-27 → owner).**
- `m2-contentsource` modes: `run` · `ingest` · `search` · `search_plan` · `harvest_plan` · `promote`. CORS on; bad input = 400, real failures = 500.
- **Watch providers (RAZ-24, Done 2026-07-17):** enrichment join, not a standalone adapter. A movie sub opts in via `params.with_providers=<TMDB country key>` in `page_material_sources` (the value is BOTH on-switch and country key). Run mode → dedup → each FRESH movie gets one gated `watch/providers` call → `enrichment.watch_providers {region, link, flatrate, rent, buy}` (provider names; empty arrays = checked-not-available; after-dedup placement = re-runs cost 0 calls). `enrichWatchProviders` in `adapters/api.ts` (shares `applyAuth` with `pullApi`); catalog entry `tmdb_watch_providers` is config-only. Live-verified: 20/20 top_rated events with TW data (13 non-empty; 刺激1995 → Netflix + Catchplay), 22 gated calls all allowed.
- `test_m2` subs: now_playing (id 1) · trending (id 2) · **top_rated (id 3, added 2026-07-17)** — all `with_providers: "TW"`.
- All 8 harvest platforms field_map VERIFIED against real payloads. Keyword search: 4/8 platforms (youtube · tiktok · reddit · pinterest — platform limit on the rest). Articles (RAZ-25): 4 Hollywood RSS feeds + scrape mode. Snapchat + vimeo hard-deleted.

**AR-1 Admin UI** — `admin/` static app (static = RECORDED decision: local-only, no deploy, no auth; service_role in gitignored `admin/config.js` + `HARVEST_WORKER_URL`). Run: static server at REPO ROOT, open `/admin/`.
**Full /code-review 2026-07-17: 9 bugs fixed + duplication/dead-code/efficiency cleanup, browser-verified 11/11 (playwright click-through against live Supabase).** Key fixes:
- **isAsync predicate was dead** (`bd_input==="search_filters"` matches nothing) — keyword-discovery panel rendered EMPTY, async search_plan path unreachable. Now `type==="brightdata" && bd_input==="keyword"` (backend's own rule); 4 discovery sources visible, Video/Shorts toggle works.
- saveCampaign: insert-first → delete-stale-by-id (+ in-flight lock + stale-source guard) — can no longer wipe a campaign.
- Promote/Discard in-flight lock (**concurrent double-promote double-emits — backend's status=new read+flip is NOT atomic**); 207 partial-failure `errors` surfaced; worker dispatch checks `res.ok` (inactive webhook ≠ dispatched) + fires concurrently; async renders re-check `state.screen` before painting; `fn()` throws on non-JSON 2xx; toast timer cleared; helpers extracted (`http` core, `loadCatalog` cache, `table`, `wireSwitch`, `fmtTs`, `refreshSource`).
- **OPEN observation (deliberately unfixed):** the UI reads working-tree `sources.json` but search executes against the DEPLOYED bundle — an edit without redeploy shows as "0 results" with no error. Currently identical.

**RAZ-19** In Review (close after post_metrics accrual). **RAZ-32/33/34** In Review — need a 9AM Workflow A run to verify.

## Rule files changed 2026-07-17 (both must be re-read)
- **claude.md:** acceptance = ONE real observed run, never "logic is sound" · DoD does not wait for commits (mark Done; he commits himself) · UI never re-implements backend logic · polling ban scoped to between-domains (vendor polling ONLY in Harvest Worker).
- **learnrules.md:** new "UI / write-path rules" section (insert-first replaces · in-flight guards on writing buttons · res.ok + shape checks · surface 207 errors · repaint guards + finally resets busy · exhaustive partitions) · BD probe codified as the ONE gate exception.

## n8n workflows
- **`2IuURyFgPsYW8wIw` M2 · Harvest Dispatcher** — 06:00 schedule + `/webhook/m2-reference-harvest` (`{ref_ids:[..]}`).
- **`g358gDdwFoHjeCSL` M2 · Harvest Worker** — ONE execution per job: gate → trigger → poll ×25 → download → ingest; giveup → Cancel Snapshot. Serves BOTH plans (harvest_plan → source_events · search_plan → sink=manual → manual_search_results). Holds no config.
- **`1gZQvoIfZULhdAiC` M2 · Trend Consumer (RAZ-26)** — ACTIVE. trend_events INSERT → idempotency guard → Enrich.
- **`iajXVmJEhE73y9n5` ZZ · BD Probe + SQL Runner (temp)** — delete when quora/threads are settled.
- Harvest workflows inactive. Creds: `Bright Data Key`, `Supabase Key`, `Postgres account`.

## Pending OWNER actions
1. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.
2. Optional: quora + threads dataset_ids (both `gd_REPLACE`, self-skip, nothing blocked).

## Database records (`supabase/database/`)
m0_infrastructure · m1_trend · 20260713_m2_source_foundation · m2_manual_search · 20260714_m2_reference_schedule · 20260716_ar1_campaign · 20260716_m0_rate_limit · 20260717_raz26_trend_events_webhook · 20260717_raz25_article_feeds — all applied. (RAZ-24 needed no SQL — config is data in `page_material_sources`.)

## Gotchas (hard-won)
- **BD bills per RECORD and keeps collecting after you stop polling.** ALWAYS `limit_per_input`; ALWAYS cancel on giveup. "Still running at timeout" = unbounded spec, NOT a slow platform.
- **A BD probe is free ONLY while the payload is INVALID** — omit a required field (differs per discovery type: `url` | `keyword` | `keyword_search`). Probe bypasses the gate (the ONE sanctioned exception); real calls go gated.
- **DISCOVER jobs are async-only** (measured 112.6s, 0 records sync). Only `bd_input=prompt` (19–78s) survives sync.
- **THE SAME DATASET RETURNS A DIFFERENT SHAPE PER DISCOVERY MODE** (pinterest keyword-discovery has no `title` key; profile-discovery does). Never inherit a field_map across modes on faith.
- **Every field_map has been wrong the same way:** `title` → account name (1-distinct); keys that don't exist (0/N). All platforms flat, no nested `engagement`. views/plays/bookmarks stay OUT of engagement (summed for `best_performing`).
- **TMDB `watch/providers` returns `results` keyed by COUNTRY** (object, not array); buckets flatrate/rent/buy hold `{provider_name,…}` objects.
- **XML/RSS `<guid isPermaLink="false">` parses to an OBJECT** → `[object Object]` dedup collapse. Use the fallback chain.
- **`field_map` values may be a FALLBACK CHAIN** (first non-empty wins); check `Array.isArray` BEFORE object branches.
- **`fillUrl` encodeURIComponents every `{placeholder}`** — right for query params, fatal for whole URLs. Feed/page URLs are assigned directly.
- **BD enums are CAPITALIZED** (`New`/`Hot`/`Top`, `Latest`/`Popular`, `Video`/`Shorts`, `All time`).
- **n8n Postgres `RETURNING` + `ON CONFLICT DO NOTHING` cannot gate anything** — emits `{success:true}` on zero rows; follow with an explicit IF.
- **n8n `addNode` has no `executeOnce`** — runs once PER INPUT ITEM. n8n silently falls back to the first credential of a matching type — attach explicitly. n8n only flushes execution data at the END — poll the DB instead.
- Supabase bundles only *imported* files — JSON needs `with { type: "json" }`. Deno type-check happens at deploy; **validate `sources.json` parses BEFORE deploy** (node one-liner).
- **PowerShell 5.1 `ConvertTo-Json` emits INVALID JSON on emoji**; PS chokes on inline node `-e` with braces — write a file to scratchpad. PostgREST filter values containing `/` must be URL-encoded or the query 400s.
- Git is not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe` (glob newest).
- 40 `tmdb_*` + 1 `bd_snapchat` legacy events in `source_events` are harmless — append-only, leave them.

## Repo state
Working tree ahead of Raze's last push (`7679356`). Uncommitted: promote mode · admin Content Source screen · CORS/400 · article adapter · keyword search ×3 · fallback chains · 2 SQL files · **RAZ-24** (`adapters/api.ts` enrichment + `index.ts` hook + `sources.json` entry) · **admin review fixes** (`admin/app.js`, `admin/style.css`) · **rule updates** (`CLAUDE.md`, `learnrules.md`) · this SESSION.md. He commits himself.
