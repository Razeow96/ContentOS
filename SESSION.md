# Content OS — Current State (updated 2026-07-20, end of session)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `CLAUDE.md`. **Admin design law: `admin/designlearnrules.md` — read before ANY /admin design.**

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Copy-paste code blocks; systems-level explanations; **English only**. Lean & fast, but **proven** (Done only after the main path ran once for real).
- **Go-live is HIS call, on his timeline** — activation · publishing · cutover · migration · commits. State a prerequisite once in its issue, then drop it. He commits himself, once per session.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP = Web Unlocker/SERP only) · `ANTHROPIC_API_KEY` Supabase secret.
- **My access:** Linear + n8n MCP; Supabase CLI linked → `functions deploy`, PostgREST, **DDL via `supabase db query --linked -f <file>`**. The migration file in `supabase/database/` is always the deliverable: write it idempotent, run it myself, verify. Cannot write n8n credential secrets.
- **Testing:** n8n via `execute_workflow` (manual). Browser-verify admin via **Playwright** (node_modules in an old scratchpad; browsers in `%LOCALAPPDATA%\ms-playwright`) + a static server at the **REPO ROOT**. **Playwright MCP is now available — resume with it instead of node scripts.**

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. Push delivery (DB webhook → n8n) BETWEEN domains. Fat events. Idempotent consumers dedup on `event_id`.
- Every outbound API call passes the rate-limit gate first (`guardedFetch`); **no row in `api_rate_limits` = DENIED**. (Debt: M1 adapters still bypass it — RAZ-54.)
- **#8 Every execution path logs (NEW 2026-07-20)** — edge fns via `withRun`, n8n via the m0 `{action:"log"}` endpoint → `run_log`. A security control; a feature that runs without logging is NOT Done.
- Config is data. **Hard output constraints are code, not prose.** UI renders what the backend serves. No secrets in files. Legacy Workflows A/B/C stay live and untouched.

## ▶ RESUME HERE
**M0–M3 built + observable. Admin is now an observability console, built domain-by-domain.**
- **Next admin work:** owner supplies each domain's **UXUI PNG one at a time**; build that domain's screen per `admin/designlearnrules.md` (6 binding rules). Only **Infrastructure** (Logs + Rate-limit) is wired so far.
- **Owner go-lives (his call, not tasks):** **publish the M3 Source Consumer** `Am5M5SauJqhZSzVb` to activate automated SourceEnriched→draft; RAZ-27 M2 cutover; M1 daily trigger.
- **Deferred until after the /admin frontend:** **RAZ-61** — trends don't drive drafts (trend keyword-search yields inspiration-tier / thin material that M3 skips). Decide (a) trends enrichment-only vs (b) a hot trend triggers an *article* pull.

## Status by domain
**M0 Infrastructure — COMPLETE + observable.** Backbone (dead_letter, sweep, content_queue, `event_trace` view over 4 streams) · rate-limit gate + `api_request_log`. **NEW `run_log`** (RAZ-58): `withRun` wraps m1/m2/m3, `{action:"log"}` endpoint for n8n, self-contained crash reaper. Realtime enabled on `run_log` + `api_request_log`.

**M1 Trend — live, NOT publishing.** `m1-trend`; daily trigger INACTIVE. Debt RAZ-54 (adapters bypass guardedFetch → M1's rate-limit drill-down stays empty).

**M2 Content Sources — build COMPLETE** (only RAZ-27 cutover, owner-timed). 6 modes; TW article feeds flowing; reference harvest v2 (atomic claim scheduler).

**M3 Content Generation — brain + gate + consumer + acceptance done.**
- Config plane 100% SQL: `page_identity`, `pillar_catalog` (7 pillars), Character Brain (`char_*`, jello template), `m3_config` (incl. **`m3_config.gate`**: dedup_days + min_lexicon per slang band).
- `m3-generate`: prefilters → single resolved SQL context → ONE Claude call → **validator** (char_range + forbidden dashes + **word-DNA presence** → one auto-revise → flags) → `content_items` + `ContentGenerated`. Claude via guardedFetch.
- **Gate (RAZ-59):** dedup = `pillar × movie_name × movie_year` over 14d (same movie under a different pillar allowed). Word-DNA min per slang (medium=2). mild_badwords inject at **medium+** (`context.ts` allowBad).
- **Consumer (RAZ-50):** `Am5M5SauJqhZSzVb` upgraded IN PLACE → gen_processed guard → POST `m3-generate` → log `run_log`. **No Telegram** (review is /admin). **Draft workflow version — publish to activate.**
- **E2E acceptance (RAZ-51):** proven — TrendDetected → SourceEnriched → ContentGenerated under ONE `correlation_id`, usable zh-TW draft observed.

## Admin (AR-1) — observability console (RAZ-62)
- Rebuilt from a ~1200-line `app.js` into **modular ES modules, no build**: `admin/{index.html, app.js router, lib/{api,ui,nav,realtime}, pages/}`.
- **Left nav = the 10-domain architecture**, collapsed; click a domain → smaller-font dropdown of its screens. Only **Infrastructure** wired → **Logs** (`run_log`) + **Rate-limit** (`api_request_log`), ecosystem-wide, **true-push realtime** (supabase-js lazy-loaded from esm.sh CDN), 10 rows/page paginated.
- **`admin/designlearnrules.md` = 6 BINDING rules, read before any /admin design:** (1) 10-domain nav collapsed (2) dropdown smaller font (3) tables 10/page + pager (4) constant-height box via blank filler rows (5) one 12.5px cell font, cells never wrap (6) fixed 2-line page header + fixed-height in-card hint slot + full-width → every table starts at the same Y. Enforced in `lib/ui.js` (`pagedBody`, `pageHeader`) + `style.css`.
- Config screens (Trend/Source/Drafts, incl. RAZ-60) **dropped from nav, kept in `pages/`** for re-add as their domains' UXUI arrives.
- **After ANY admin edit, HARD-REFRESH the browser (Ctrl+Shift+R)** — ES modules + CSS cache hard; a stale tab shows the old UI.

## Rule files changed
- **`CLAUDE.md`** — new invariant **#8** (every execution path logs).
- **`admin/designlearnrules.md`** — NEW (admin UI design law).
- Domain `CLAUDE.md` pointers updated: m0 (run_log write-through), m3 (gate dedup + word-DNA).

## n8n workflows
- **`Am5M5SauJqhZSzVb` M3 Source Consumer** — RAZ-50 upgrade (webhook → gen_processed → m3-generate → run_log). **DRAFT version; owner publishes to go live.**
- **`1gZQvoIfZULhdAiC` M2 Trend Consumer** — ACTIVE (searches trend topic, sink=events → source_events, carries correlation).
- **`2IuURyFgPsYW8wIw` Harvest Dispatcher · `g358gDdwFoHjeCSL` Harvest Worker · `FDMb0ugyE1Wu0MWO` M4 placeholder.**

## Pending OWNER actions
1. **Publish** the M3 Source Consumer (activates automated drafts).
2. Provide **domain UXUI PNGs** for the admin console (domain by domain).
3. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.
4. Provide competitor + lifestyle URLs for RAZ-53.
5. Decide RAZ-61 (trends→generation) after /admin.

## Database records (`supabase/database/`) — all applied
m0_infrastructure · m1_trend · 20260713_m2_source_foundation · m2_manual_search · 20260714_m2_reference_schedule · 20260716_ar1_campaign · 20260716_m0_rate_limit · 20260717_raz26/25 · 20260718_raz43/47/46 · 20260719_raz48/48b/57/57jello/49 · **20260720_raz58_run_log · 20260720_raz58b_realtime · 20260720_raz59_m3_gate.**

## Gotchas (hard-won; deep knowledge lives in each domain's readme.md)
- **Admin = ES modules, no build, served from repo root. HARD-REFRESH after edits** (cache). Realtime = supabase-js from esm.sh CDN (needs internet) + tables in `supabase_realtime` publication.
- **Trend keyword-search material is inspiration-tier / thin → M3 skips** (RAZ-61). The draftable trend path is run-mode-with-trend pulling article feeds.
- **PowerShell 5.1 mangles UTF-8 Chinese** on `Invoke-RestMethod`/`ConvertTo-Json` round-trips — write the body to a UTF-8 (no BOM) file + `curl --data-binary @file`. PS `\echo` isn't psql; the db-query runner returns only rows.
- **BD bills per RECORD and keeps collecting after you stop polling** — always `limit_per_input`, always cancel on giveup. DISCOVER jobs are async-only. A BD probe is free ONLY while the payload is invalid.
- **Every field_map has been wrong the same way** — verify against ONE real payload (`select payload->'raw'`); `title`→account-name (1-distinct) or keys that don't exist (0/N). `external_id` is load-bearing for dedup.
- TMDB `watch/providers` keyed by COUNTRY. XML `<guid isPermaLink="false">` parses to an OBJECT (use the fallback chain). BD enums are CAPITALIZED.
- n8n Postgres `RETURNING`+`ON CONFLICT DO NOTHING` can't gate directly — the consumers gate via an IF on the returned `event_id` (works). Supabase bundles only *imported* files (JSON needs `with { type: "json" }`).
- Git not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`. IDE "Cannot find name 'Deno'" is cosmetic (deploy bundler is the real type-check).
- Truncated Claude JSON = raise `max_tokens` in `m3_config` first (config change, no redeploy).

## Repo state
Working tree ahead of Raze's last push (all of today's M0/M3 + full admin rebuild + rule files + migrations). He commits himself.
