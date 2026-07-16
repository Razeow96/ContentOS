# Content OS — Current State (updated 2026-07-16)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `claude.md` (read both at session start).

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Give copy-paste code blocks; explain at systems level; lean & fast.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **repo is PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (**MCP added 2026-07-16 — needs a Claude Code restart to load**).
- **My access:** Linear + n8n MCP. Supabase CLI linked → I **can** `supabase functions deploy` and read/write data via PostgREST. I **cannot** run DDL (**SQL goes to Raze as a committed file in `supabase/database/`**, never chat-only) and **cannot write n8n credential secrets**.
- **Testing n8n:** always `execute_workflow` (manual mode) via MCP. Never ask Raze to publish/activate — activation is go-live only.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. Push delivery (DB webhook → n8n). Fat events. Idempotent consumers dedup on event_id.
- **Every outbound API call passes the rate-limit gate first** (see M0 below). No raw `fetch()` in adapters, no raw calls from n8n.
- No secrets in files. Legacy Workflows A (`Sd2dD8Ci9yHhThmG`), B (`RiibWUSoeZgvLs9Q`), C (`EPA725LVP3cb3m7a`) stay live and untouched.

## ▶ RESUME HERE — reddit + youtube are the only open harvest work

**Blocked on two owner actions:**
1. **Paste the new Bright Data API key** into the n8n credential **`Bright Data Key`** (`yMXmsI7s6Oupb1jk`). New BD account = new key; the credential holds the dead one. I cannot write credential secrets.
2. **Restart Claude Code** so the Bright Data MCP loads (not visible in my session yet) — then I confirm/pull dataset IDs from it. Note `gd_` IDs are BD's *library-wide* scraper IDs, not account-scoped, so the current ones may already be valid.

**Then (small, ~20 credits):** one capped worker run each for reddit + youtube (cap=10) → read the raw records → fix both field_maps → done.
```
# how to fire one platform in isolation (no publish needed):
harvest_plan ref_ids=[12] (reddit) / [10] (youtube)  ->  execute_workflow g358gDdwFoHjeCSL manual, webhookData.body = that job
```
**Zero-cost alternative:** 6 runaway snapshots (~2,972 reddit + ~3,286 youtube records) are already PAID FOR and sitting in BD. If the old account is still readable, `GET /datasets/v3/snapshot/{id}` verifies both field_maps for free. Ids: reddit `sd_mrn93ysxbs6fpnqfj`, `sd_mrn7ar5b2ksyj00jrq`; youtube `sd_mrn943jnysqwul41q`, `sd_mrn5y7271ce0jaiv40`.

**Config already fixed for both (deployed, unproven):**
- **reddit** — `discover_by=subreddit_url`; inputs are `url + sort_by + sort_by_time + keyword + start_date`. `sort_by:"new"` lowercase is REJECTED; `"Hot"` passes (probed). Capitalized `"New"` untested → try it for true latest_n.
- **youtube** — dataset **`gd_lk538t2k2p1k3oos71`**, takes channel **`/about`** URLs natively, NO discover params. ref_url = `https://www.youtube.com/@movierecapsofficial/about`.

## Status by domain

**M0 Infrastructure — COMPLETE + rate-limit gate added today (RAZ-42, In Review).**
- Backbone live: demo_events, dead_letter, sweep_attempts, content_queue, event_trace view, hourly sweep.
- **API rate-limit gate** `supabase/functions/m0-infrastructure/` — `rate-limit/{config,ratelimit,index}.ts` = `guardedFetch` library for edge functions; `index.ts` = deployable gate endpoint for **n8n** (can't import Deno). SQL: `api_rate_limits` (per-provider DAILY **request AND record** budgets — **no row = denied**, so adding the row IS the approval), `api_usage_counters`, `api_request_log` (append-only ledger). **Fail-closed.** BD budget set to **150 req + 150 records/day**.
- Verified: allow path (TMDB, ledger + counter reconciled), fail-closed, and **deny on the n8n worker with `Trigger Scrape` never firing**.

**M1 Trend Intelligence — live-verified, NOT publishing yet.** `m1-trend` edge fn; sources google_trends_daily, youtube, youtube_film; 3 real pages configured (mateo, jello_topmovie_svs, daily_movie_edc), 35 trends detected. Daily Trigger `bZyOyWkgtzj7ucUY` **INACTIVE on purpose** — publish M1+M2 together once M2 has a live consumer. Open: RAZ-18 (needs a multi-day window once scheduled).

**M2 Content Sources — function live; harvest rebuilt parallel (RAZ-36 In Progress).**
- `m2-contentsource` modes: `run` · `ingest` · `search` (sink=events|manual) · **`harvest_plan`** (read-only; joins page_reference_sources × catalog → ready-to-execute jobs so n8n holds ZERO config).
- **AI-search: all 5 proven live** — google_ai 19s (fastest, prefer as default) · gemini 30s · copilot 54s · chatgpt 69s · perplexity 78s.
- **Social field_maps VERIFIED (7/9)**: facebook (incl. Reels), x, instagram, tiktok, pinterest, linkedin, snapchat. **Unproven:** reddit, youtube. **Vimeo ABANDONED** (BD rejects channel URLs; only takes individual video URLs or keyword-search — incompatible with the reference-page model).
- Open: RAZ-25 (article rss/scrape), RAZ-24 (listings), promote-bridge for `manual_search_results`, manual-form BD source checklist.

**AR-1 Admin UI — RAZ-39 In Review; RAZ-40 (Content Source screen) not started.**
- `admin/` static app. **Run:** static server at the **REPO ROOT**, open `/admin/`. Not from inside `admin/`, not `file://` (it fetches the real `trendsource.json` off disk so the catalog can't drift). Needs the **service_role** key in gitignored `admin/config.js` (page_* tables are RLS-protected; anon reads 0 rows).
- Screens: **Trend** (gates, campaigns, honest fields, trends feed) · **Infrastructure** (budget bars + request ledger, filters) · Content Source = stub (RAZ-40).
- Campaign column applied. Not yet click-tested in a browser.

**RAZ-19 Analytics seed — In Review**, workflow `6OZ8xse9mkajn7X7` active daily 10:00. Close after accrual.
**Legacy patches RAZ-32/33/34 — In Review**, still need verifying on a 9AM Workflow A run.

## n8n workflows (harvest)
- **`2IuURyFgPsYW8wIw` M2 · Harvest Dispatcher** — schedule 06:00 (`harvest_schedule='daily'` refs) + webhook `/webhook/m2-reference-harvest` (`{ref_ids:[..]}`; this is the AR-1 run-now hook) → harvest_plan → split → fire one POST per job at the worker, fire-and-forget, continue-on-error.
- **`g358gDdwFoHjeCSL` M2 · Harvest Worker** — ONE isolated execution per job: `Job In → Rate Limit Gate → Gate Allowed? → Trigger Scrape → Wait 60s → Poll → Ready? → Download → Ingest`. Giveup after 25 polls → **Cancel Snapshot** → `Ended Without Data`. Denied → `Harvest Denied`.
- **`iajXVmJEhE73y9n5` ZZ · BD Input Probe (temp)** — fires candidate BD payloads with neverError and returns the validation echo. **Validation errors are free; accepted payloads start billing.** Delete when platforms are done.
- Both harvest workflows **inactive** — only needed at go-live. Credentials: `Bright Data Key` + `Supabase Key` (both Bearer Auth), all wired.

## Pending OWNER actions
1. **New BD API key → n8n `Bright Data Key` credential.** ← blocks reddit/youtube
2. **Restart Claude Code** for the Bright Data MCP. ← blocks dataset-ID confirmation
3. Activate RAZ-26 (trend consumer): Supabase Edge Fn cred on its Enrich node + DB webhook on `trend_events`.
4. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.
5. Optional: Quora + Threads dataset_ids (both error defensively; nothing blocked).

## Database records (`supabase/database/`)
m0_infrastructure · m1_trend · 20260713_m2_source_foundation · m2_manual_search · 20260714_m2_reference_schedule · 20260716_ar1_campaign · **20260716_m0_rate_limit** — all applied.

## Gotchas (hard-won)
- **BD discover bills per RECORD and keeps collecting after you stop polling.** Uncapped crawls burned the whole 5,000 trial (6 runs ≈ 6,258 records). ALWAYS `limit_per_input`; ALWAYS cancel on giveup. **"Still running at timeout" = unbounded job spec, NOT a slow platform** — never re-fire with a longer window.
- **Every field_map has been wrong the same way**: `title` → the account name (1-distinct), captions/images at keys that don't exist. No platform has a nested `engagement` object — all flat counts. views/plays/bookmarks stay OUT of engagement (it's summed for `best_performing`; views dwarf likes).
- **Validate `sources.json` parses BEFORE `supabase functions deploy`** — a dropped brace deployed invalid JSON and took the function to BOOT_ERROR.
- **PowerShell 5.1 `ConvertTo-Json` emits INVALID JSON** on emoji-heavy captions. Use node's `JSON.stringify` (see `reingest.js` pattern) and `[System.IO.File]::WriteAllText` (Out-File adds a BOM node can't parse).
- **n8n silently falls back to the first credential of a matching type** when none is attached → confusing 401s. Attach explicitly.
- **n8n only flushes execution data at the END** — `runData` is empty while running; poll the DB instead.
- Supabase bundles only *imported* files — JSON catalogs need `with { type: "json" }`. Deno not installed locally; type-check happens at deploy.
- Git is not on PATH: resolve it under `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe` (GitHub Desktop auto-updates, so glob for the newest).
- 40 `tmdb_*` events in `source_events` on `test_m2` are harmless (a malformed body once fell through to `mode=run`; now returns 400). Leave them.

## Repo state
13+ commits ahead of origin, **not pushed** (owner's call). `.gitignore` covers `m2dbidconfiguration/`, `fb1.png`, `vimeo2.png`, `admin/config.js` — all contain credentials in screenshots or key files.
