# Content OS — Current State (updated 2026-07-23, end of session)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `CLAUDE.md`. **Admin design law: `admin/designlearnrules.md` — read before ANY /admin design. Diagram-drawing law: `docs/diagramflows/drawingrules.md` — read before ANY flow diagram.**

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Copy-paste code blocks; systems-level explanations; **English only**. Lean & fast, but **proven** (Done only after the main path ran once for real).
- **Go-live is HIS call, on his timeline** — activation · publishing · cutover · migration · commits. He commits himself, once per session.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP) · Eraser.ai (MCP) · `ANTHROPIC_API_KEY` + `HARVEST_INGEST_SECRET` Supabase secrets.
- **My access:** Linear + n8n + Eraser MCP. Supabase CLI linked → `functions deploy`, PostgREST, **DDL via `supabase db query --linked -f <file>`**. Edge-fn HTTP tests read the service key from `admin/config.js` (gitignored). Migration files in `supabase/database/` are the deliverable.
- Claude Max plan = Opus 4.8 (Fable 5 is API-credit only, not on Max — verified 2026-07-23; not worth it for this workload anyway).

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. **Push delivery = DB webhook → the DOMAIN'S EDGE FUNCTION** (bearer baked in the trigger def; `verify_jwt`). Fat events. Idempotent consumers dedup on `event_id` (seen-log INSERT … ON CONFLICT DO NOTHING).
- **n8n is trigger/schedule/orchestrate ONLY** — consumption/fan-out/heavy compute live in edge functions/SQL (RAZ-63).
- **One domain = one folder = one deployed edge function** with internal routing. NEVER a stray top-level function for a sub-feature.
- Every outbound API call passes the rate-limit gate first (`guardedFetch`); **no row in `api_rate_limits` = DENIED**. (Debt: M1 adapters bypass it — RAZ-54.)
- **#8 Every execution path logs** — edge fns via `withRun`, n8n via m0 `{action:"log"}` → `run_log`.
- Config is data. Hard output constraints are code, not prose. UI renders what the backend serves. No secrets in files. Legacy A/B/C untouched.
- **ID-spine law:** every hop carries `correlation_id · trend_signal_id · page_id · keywords`, M1 → generation → onto the draft. One `page_id` end-to-end.

## ▶ RESUME HERE
**Epic RAZ-61 nearly complete — the pipeline produces REAL trend-driven drafts.** Anthropic credits topped up 2026-07-23; blocker gone.
- **RAZ-71 Stage 1 (page_id parity) — DONE.** RAZ-72 Stage 2 (trend_signal_id spine) — **DONE, both halves proven live.** RAZ-73 Stage 3 (trend-joined compiled pull + freshness tags) — **DONE, acceptance met live.**
- **Proof of record (2026-07-23):** campaign `trend_signal_id 0e73843b` → 10 google topics → `trendConsume` compiled pull → ONE SourceEnriched **v3** (6 real 放映週報 articles, `freshness:"recent"`, full spine) → **draft `content_items` 18** (《獨奏者之舞》· behind_the_scenes · 801 chars · validator green) → ContentGenerated v2 → M4 n8n received (exec 2335). Same tsid on every table. Thin-TMDB compile (「美 伊」) correctly REFUSED by the model. Manual-path draft 17 (《我的棋王爺爺》, tsid null + real correlation) proven same day.
- **NEXT BUILD: RAZ-74 Stage 4** — dedup write-back tuning + per-entity/day cap (degenerate keywords like "2026" over-match feeds). Then **RAZ-64 Publishing domain** (the big one — replaces Workflow B, absorbs n8n M4 placeholder `FDMb0ugyE1Wu0MWO`).
- **RAZ-75 (Backlog, owner-deferred):** TMDB credits enrichment — cast/director as evidence (watch-providers pattern). Build when Raze pulls it.
- **RAZ-69 (Analytics FB → m7-analytics) BUILT + PROVEN, POSTPONED** (owner schedules).

## ⏸ OPEN DECISION — structure review (discussed 2026-07-23, Raze deciding after restart)
Raze asked for an honest review of his structure (docs, feature-by-feature, velocity, bug causes). Verdict delivered: **feature-by-feature is right; the one flaw was no standing end-to-end pipeline proof** — all major bugs were one class (feature-local Done, cross-domain break: page-id drift ×3, dead M4 webhook, thin-TMDB gap). Worktrees: no (bottleneck is his review bandwidth, not parallelism). Sub-agents: no for builds (context is the asset), yes for review sweeps (already used). One-off Linear docs: no — the **RAZ-61 shape (Eraser diagram → staged issues → end-to-end acceptance) is the proven pattern** for any ≥2-domain work.
**Two learnrules proposals AWAITING HIS YES/NO** (exact text shown in chat 2026-07-23, do not append without approval):
1. **"Pipeline proof beats feature proof"** — ≥2-domain features are Done only when the pipeline's main path ran (campaign → draft). Fix already proven by RAZ-61 → appendable immediately on approval.
2. **"Shared identity is enforced by schema, never by vigilance"** — one `pages` registry table + FKs so a wrong page_id fails at INSERT (drift happened 3× despite written rules). Fix NOT yet built/proven — needs the registry migration built, applied, and one bad insert rejected before appending. If approved: write the Linear ticket first (spec-of-record), then build.
Also on his go-live list as the standing pipeline proof: activate the M1 daily trigger (his call).

## Status by domain
**M0 Infrastructure — COMPLETE + observable.** Gate + `api_request_log` · `run_log` · sweep in `m0-infrastructure {action:"sweep"}`.

**M1 Trend — live, daily trigger INACTIVE.** Mints `trend_signal_id` per campaign (TrendDetected v3, payload carries `signal_type`). Debt RAZ-54. Gap: youtube trend topics = raw VIDEO TITLES (unjoinable) — keyword extraction is a future M1 capability.

**M2 Content Sources — COMPLETE + trend compile.** `trendConsume` now runs **`runTrendCompile`** (RAZ-73): manual leg = free `search:true` sources (tmdb_search); auto leg = page article feeds KEYWORD-filtered + BD AI-search opt-in via `page_source_settings.trend_bd_sources` (all NULL = zero BD spend). Per-source `freshness` tags (recent/trend/hot) + `trend_pull` knobs in sources.json. Guards proven live: only `trend_pull.keyword_signal_types` (`search_trend`) compile — title-grade skips cheap; **`feed_cache` table (30-min TTL)** = one feed fetch per campaign burst; cap-aware dedup claims. SourceEnriched **v3** (recorded on RAZ-20). See `m2-contentsource/readme.md` § Trend-compiled pull.

**M3 Content Generation — COMPLETE for drafts.** Accepts `material_type:"compiled"` (m3_config). Compiled-brief prompt: freshness = pillar priority, inspiration-tier items = context-only (never facts, excluded from evidence). Per-item evidence/media_refs. Model `claude-sonnet-5`, cap 20/day, dedup 14d.

**M7 Analytics — seed built (RAZ-69), not scheduled.**

## Edge functions
`m0-infrastructure` · `m1-trend` · `m2-contentsource` · `m3-generate` · `m7-analytics`. m2 + m3 REDEPLOYED 2026-07-23 (RAZ-73).

## n8n workflows (trigger/orchestrate only)
- **ACTIVE:** `2IuURyFgPsYW8wIw` Harvest Dispatcher · `g358gDdwFoHjeCSL` Harvest Worker · `oPczta2FM9jhzEj0` Manual AI Keyword Search · `JBjp7TLyhX5cwkjT` M0 Sweep (hourly) · `RiibWUSoeZgvLs9Q` Workflow B (legacy, until RAZ-64) · `FDMb0ugyE1Wu0MWO` M4 content_events placeholder (fold into RAZ-64).
- **INACTIVE:** `bZyOyWkgtzj7ucUY` M1 Daily · `6OZ8xse9mkajn7X7` FB seed · legacy A/C.

## Migrations (`supabase/database/`) — all applied
…prior set… · **20260723_raz73_trend_compile.sql** (page_source_settings.trend_bd_sources + m3_config material_types += compiled) · **20260723_raz73_feed_cache.sql** · **20260723_raz73_trend_settings_parity.sql** (page_trend_settings jello_topmovie_svs → jello — the THIRD parity table).

## Live/non-migration state (handoff gap)
- Webhook repoints (server-side trigger defs, bearer baked in): `trend_events → m2-contentsource` · `source_events → m3-generate` · `content_events → n8n m4`.
- Stale leftover: `trend_events` trigger → dead `…/webhook/backbone-demo-events` (drop when convenient).
- Test events from proofs retained in append-only streams (normal). `content_items` now holds real drafts 17 + 18 (status draft — feeding the 14-day dedup memory).
- Yahoo (`tw.news.yahoo.com`) + LTN (`news.ltn.com.tw`) daily record budgets were exhausted 2026-07-23 by the pre-fix burst — reset on the daily window, nothing to do.

## Pending OWNER actions
1. **Decide the two learnrules proposals** (see OPEN DECISION above).
2. **RAZ-74 Stage 4** — say go and I build (spec exists).
3. **RAZ-64 Publishing domain** — the big build.
4. Optional go-live: activate M1 daily trigger `bZyOyWkgtzj7ucUY` (doubles as the standing pipeline proof).
5. Schedule `m7-analytics` (RAZ-69); retire n8n seed `6OZ8xse9mkajn7X7`.
6. RAZ-75 TMDB credits enrichment — deferred, pull when wanted.
7. Provide domain UXUI PNGs for the admin console.
8. Optional cleanup: drop stale backbone-demo trigger; delete archived n8n workflows.

## Gotchas (hard-won; deep knowledge lives in each domain's readme.md)
- **DB webhook → edge fn needs the bearer in the trigger header** (verify_jwt). BD push-delivery uses anon key + shared-secret `k` param.
- **One page = one id across domains** — drift found in THREE tables now (`page_trend_sources`, trend payloads, `page_trend_settings`). Schema-level fix (pages registry + FKs) is proposal #2 above.
- **A campaign burst fires one consumer PER trend** — anything fetched per-trend must be cached across the burst (`feed_cache`) or budgets burn (proven: 50 youtube-title trends × 2 Yahoo feeds = budget gone).
- **Only keyword-grade trends compile** (`trend_pull.keyword_signal_types`); youtube `trending_rank` topics are raw video titles.
- **Heavy generation doesn't parallelize freely** — sweep capped 5/stream. Queue concern for RAZ-64.
- **Admin = ES modules, no build, served from repo root. HARD-REFRESH after edits.**
- **PowerShell 5.1 mangles UTF-8 Chinese** on round-trips — UTF-8 (no BOM) file + `curl --data-binary @file`. PostgREST `in.(…)` with hundreds of ids overruns URL limit — chunk ~50.
- **BD bills per RECORD and keeps collecting after you stop polling** — always `limit_per_input`.
- **Every field_map has been wrong the same way** — verify against ONE real payload. `external_id` is load-bearing for dedup.
- **Eraser diagrams:** DSL only (freehand invisible to MCP). Board `review` = `EtP0l1CYqAys3GJPso5v`; AS-IS rewritten 2026-07-23 to post-RAZ-73 live state; TARGET = realized.
- Seen-log redelivery test technique: delete the `gen_processed`/`src_processed`/`trends` row, re-POST/re-run — legit at-least-once simulation. m1 `trends` dedup keys have `window_day`/`detected_at`, NOT `created_at`.
- Supabase bundles only *imported* files. Git not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`.

## Repo state
Working tree ahead of Raze's last push: RAZ-73 code (m2 compile + guards, m3 compiled-brief, sources.json freshness/trend_pull, m2 readme + CLAUDE.md currency note), 3 migrations (20260723_*), `temporaryreview/2026-07-23-drafts.md` (drafts 17+18 reading copy — temporary, his to delete). He commits himself. Live DB/n8n state above is NOT in the tree.
