# Content OS — Current State (updated 2026-07-22, end of session)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `CLAUDE.md`. **Admin design law: `admin/designlearnrules.md` — read before ANY /admin design. Diagram-drawing law: `docs/diagramflows/drawingrules.md` — read before ANY flow diagram.**

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Copy-paste code blocks; systems-level explanations; **English only**. Lean & fast, but **proven** (Done only after the main path ran once for real).
- **Go-live is HIS call, on his timeline** — activation · publishing · cutover · migration · commits. He commits himself, once per session.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP) · Eraser.ai (MCP — flow diagrams) · `ANTHROPIC_API_KEY` + `HARVEST_INGEST_SECRET` Supabase secrets.
- **My access:** Linear + n8n + Eraser MCP. Supabase CLI linked → `functions deploy`, PostgREST, **DDL via `supabase db query --linked -f <file>`**. Edge-fn HTTP tests read the service key from `admin/config.js` (gitignored). Migration files in `supabase/database/` are the deliverable.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. **Push delivery = DB webhook → the DOMAIN'S EDGE FUNCTION** (bearer baked in the trigger def; `verify_jwt`). Fat events. Idempotent consumers dedup on `event_id` (seen-log INSERT … ON CONFLICT DO NOTHING).
- **n8n is trigger/schedule/orchestrate ONLY** — consumption/fan-out/heavy compute live in edge functions/SQL (RAZ-63).
- **One domain = one folder = one deployed edge function** with internal routing. NEVER a stray top-level function for a sub-feature.
- Every outbound API call passes the rate-limit gate first (`guardedFetch`); **no row in `api_rate_limits` = DENIED**. (Debt: M1 adapters bypass it — RAZ-54.)
- **#8 Every execution path logs** — edge fns via `withRun`, n8n via m0 `{action:"log"}` → `run_log`.
- Config is data. Hard output constraints are code, not prose. UI renders what the backend serves. No secrets in files. Legacy A/B/C untouched.
- **ID-spine law (new):** every hop carries `correlation_id · trend_signal_id · page_id · keywords`, M1 → content generation → onto the draft. One `page_id` end-to-end. (See `docs/diagramflows/drawingrules.md`.)

## ⛔ ACTIVE BLOCKER
**Anthropic API credits exhausted** — every `m3-generate` call returns `400 credit balance too low`. Blocks ALL real content generation (Stage 2's final proof, Stage 3, Stage 4). **Owner action: top up credits on the `ANTHROPIC_API_KEY`.** Code is fine; the model call can't run until credits return.

## ▶ RESUME HERE
**Epic RAZ-61 in progress: fix the trend→generation pipeline (progressive accumulation + ID spine).** Design of record = Eraser board **review** (`EtP0l1CYqAys3GJPso5v`, AS-IS + TARGET diagrams). Four staged sub-issues:
- **RAZ-71 Stage 1 — page_id parity — DONE + proven.** Trend subs reconciled `jello_topmovie_svs`→`jello`; trend path no longer dies at M3 identity.
- **RAZ-72 Stage 2 — trend_signal_id spine — In Review (dummy-tested, awaiting Claude credit).** Code deployed across M1/M2/M3; M1→M2 proven live; M3→M4 proven with dummy content; real generation test blocked on credits.
- **RAZ-73 Stage 3 — trend-joined compiled M2 pull + freshness tag (the draft-producing fix, ex-RAZ-61 core) — BLOCKED on credits.**
- **RAZ-74 Stage 4 — content_items persistence + dedup write-back + per-entity/day cap — BLOCKED on credits.**
- **Biggest separate open build: RAZ-64 — Publishing domain** (replaces legacy Workflow B; absorbs the still-on-n8n M4 content_events placeholder `FDMb0ugyE1Wu0MWO`).
- **RAZ-69 (Analytics FB → `m7-analytics`) BUILT + PROVEN but POSTPONED** (owner schedules when ready).

## Status by domain
**M0 Infrastructure — COMPLETE + observable.** Backbone · rate-limit gate + `api_request_log` · `run_log` · sweep folded into `m0-infrastructure {action:"sweep"}`.

**M1 Trend — live, NOT publishing.** `m1-trend`; daily trigger INACTIVE. Now MINTS one `trend_signal_id` per campaign run and stamps every event (TrendDetected **v3**). Debt RAZ-54.

**M2 Content Sources — COMPLETE.** `m2-contentsource` = modes (run/ingest/search/harvest_plan/search_plan/promote) + trend_events webhook consumer + BD harvest push-delivery. Trend consumer now threads `trend_signal_id` onto emitted `source_events` (SourceEnriched **v2**). Trend-joined rich pull is Stage 3 (RAZ-73).

**M3 Content Generation — brain + gate + consumer done.** `m3-generate` = generation + webhook dedup on `gen_processed`. Config plane 100% SQL (`claude-sonnet-5`, cap 20, dedup 14d). Validator (char_range + forbidden dashes + word-DNA). Now writes `content_items.trend_signal_id` (+column) and `content_events.trend_signal_id` (ContentGenerated **v2**). **Real drafts blocked on Anthropic credits.**

**M7 Analytics — seed built (RAZ-69), not scheduled.** `m7-analytics` edge fn → `post_metrics`. Postponed.

## Edge functions (the real logic)
`m0-infrastructure` (gate + log + sweep) · `m1-trend` · `m2-contentsource` (+trend-consume +harvest-ingest) · `m3-generate` (+webhook dedup). `m7-analytics`. All of m1/m2/m3 REDEPLOYED 2026-07-22 with the additive `trend_signal_id` spine.

## n8n workflows (trigger/orchestrate only)
- **ACTIVE:** `2IuURyFgPsYW8wIw` Harvest Dispatcher · `g358gDdwFoHjeCSL` Harvest Worker · `oPczta2FM9jhzEj0` Manual AI Keyword Search · `JBjp7TLyhX5cwkjT` M0 Sweep Schedule (hourly) · `RiibWUSoeZgvLs9Q` Workflow B (legacy poster, until RAZ-64) · `FDMb0ugyE1Wu0MWO` M4 content_events placeholder (still n8n — receives ContentGenerated; fold into RAZ-64).
- **INACTIVE:** `bZyOyWkgtzj7ucUY` M1 Daily · `6OZ8xse9mkajn7X7` FB seed · legacy A/C.

## Live DB changes this session NOT yet in a migration file (handoff gap)
- **RAZ-72 contracts are additive in jsonb payloads** — the `content_items.trend_signal_id` column IS a migration file (`20260722_raz72_trend_signal_id.sql`); the payload fields on trend_events/source_events/content_events need no DDL.
- **Webhook repoints (from prior session, still true):** `trend_events → m2-contentsource`, `source_events → m3-generate`, `content_events → n8n m4`, each with the bearer baked into the trigger def — server-side, cannot be a committed migration as-is.
- **`api_rate_limits` row** for `graph.facebook.com` (RAZ-69) via PostgREST.
- **Stale leftover:** a `trend_events` trigger still POSTs every insert to a dead `…/webhook/backbone-demo-events` (RAZ-7 demo). Harmless; drop when convenient.
- **Dummy proof row:** one `content_events` row (event_id `1c979298…`, aggregate_id 16) written 2026-07-22 to prove the M3→M4 spine with dummy content — append-only test event, retained. Its `content_items` row (id 16) was deleted after the proof.

## Findings recorded this session (2026-07-22)
- **Page-id drift was the trend path's real killer (G2, now fixed).** Trend subs lived under `jello_topmovie_svs`; identity under `jello` → `loadContext` returned null → M3 skipped. Reconciled in RAZ-71.
- **trend_signal_id ≠ correlation_id.** correlation_id = the flow; trend_signal_id = WHICH trend (one per campaign run). Both thread the whole chain; manual/promote/direct-test paths carry a real correlation_id but a null trend_signal_id.
- **Dummy content proves plumbing, not generation.** M3→M4 delivery + the spine were proven with a dummy draft (real lineage ids, fake copy) because Claude is credit-blocked — the writer path runs for real on Stage 3's first draft.
- **The adapter→normalize layer already exists** (per-platform `field_map` + `type`-based adapters + `normalize.ts`) — Stage 3 extends it, doesn't rebuild. Missing bits: per-platform capability configs (e.g. YouTube recent/hot/new-upload charts) + a unified freshness tag (`recent/trend/hot`).

## Pending OWNER actions
1. **Top up Anthropic credits** (unblocks Stage 2 final proof + Stages 3/4).
2. **RAZ-64 Publishing domain** — the big build (replaces Workflow B; absorbs M4 consumer; the generation/publish queue).
3. Schedule **`m7-analytics`** (RAZ-69) when ready; retire n8n seed `6OZ8xse9mkajn7X7`.
4. Provide **domain UXUI PNGs** for the admin console (domain by domain).
5. Optional cleanup: drop the stale `trend_events`→backbone-demo-events trigger; delete the 3 archived n8n workflows permanently.
6. Review/edit the Eraser TARGET diagram if the intended flow needs refinement before Stage 3.

## Database records (`supabase/database/`) — all applied
…prior set… · **20260722_raz71_page_id_parity.sql** (trend subs → jello) · **20260722_raz72_trend_signal_id.sql** (content_items.trend_signal_id column + index).

## Gotchas (hard-won; deep knowledge lives in each domain's readme.md)
- **DB webhook → edge fn needs the bearer in the trigger header** (verify_jwt). BD push-delivery to `m2-contentsource?ingest=harvest` uses the anon key in `auth_header` + a shared-secret `k` query param.
- **One page = one id across domains** — was the trend-path killer (jello_topmovie_svs ≠ jello). Fixed in RAZ-71; verify id parity before wiring any new handoff.
- **Heavy generation doesn't parallelize freely** — real generations are Claude-heavy; a cap-25 concurrent re-delivery OOMs. Sweep capped at 5/stream. Queue concern for RAZ-64.
- **Admin = ES modules, no build, served from repo root. HARD-REFRESH after edits.**
- **Trend keyword-search material is thin (TMDB) → M3 refuses**; rich material = article feeds. Trend-joined pull = RAZ-73.
- **PowerShell 5.1 mangles UTF-8 Chinese** on round-trips — write a UTF-8 (no BOM) file + `curl --data-binary @file`. A PostgREST `in.(…)` with hundreds of ids overruns the URL limit — chunk ~50.
- **BD bills per RECORD and keeps collecting after you stop polling** — always `limit_per_input`. DISCOVER jobs async-only; BD push-delivers snapshots.
- **Every field_map has been wrong the same way** — verify against ONE real payload (`select payload->'raw'`). `external_id` is load-bearing for dedup.
- **Eraser flow diagrams:** DSL (two-way with owner), NOT freehand (freehand is invisible to the MCP). One tall box per domain holds columns; sub-features numbered `Mn.k`, streaming down; edges forward-only. Board `review` = `EtP0l1CYqAys3GJPso5v`.
- Supabase bundles only *imported* files. Git not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`. IDE "Cannot find name 'Deno'" is cosmetic.

## Repo state
Working tree ahead of Raze's last push: this session's edge-fn changes (m1/m2/m3 `trend_signal_id` spine — deployed), two migrations (`raz71`, `raz72`), `docs/diagramflows/drawingrules.md` (+ deleted `pipeline-m1-m3.dataflow.md`), and the Eraser board `review`. `temporarysession.md` deleted (its Eraser+Linear handoff is done). He commits himself. Live DB/n8n changes (above) are NOT in the working tree.
