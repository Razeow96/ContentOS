# Content OS — Current State (updated 2026-07-19, end of session)

Living state doc (not an append log — trimmed to only what's current). Content OS = a DDD, event-driven content-automation OS: 10 domains migrating OFF 3 legacy n8n workflows via the strangler pattern. Domains talk ONLY via events in per-aggregate SQL stream tables. Governed by ADR-001 (Linear). Working rules: `learnrules.md` + `CLAUDE.md` — **both changed 2026-07-19, see "Rule files changed" below.**

## Who / stack / how I work
- **Raze** — architect/founder, **not a coder**. Copy-paste code blocks; systems-level explanations; **English only** (he can't read Mandarin — Chinese belongs only inside content artifacts). Lean & fast.
- **Acceptance:** a feature is Done ONLY after its main path ran once for real with the result observed. No edge-case hunting beyond it. Mark Done in Linear immediately — never wait for or mention his commit; he commits himself, once per session.
- **Go-live is HIS call, on his timeline.** Activation · publishing · cutover · migration are NOT tasks and NOT blockers — state a prerequisite once in its Linear issue, then drop it.
- **Stack:** GitHub `ContentOS` (owner Razeow96, **repo is PUBLIC**) · VS Code · n8n (razeow.app.n8n.cloud, MCP) · Supabase (ref `qbxpizyemqwcokdkpbqe`) · Linear (team `Razeow`, project `Content OS`, MCP) · Bright Data (MCP = Web Unlocker/SERP only, no dataset tools) · Anthropic API key set as the `ANTHROPIC_API_KEY` Supabase secret.
- **My access:** Linear + n8n MCP; Supabase CLI linked → `supabase functions deploy`, PostgREST read/write, and **DDL via `supabase db query --linked -f <file>`** (preferred; the n8n Postgres node on `Postgres account` / `J2c18reEy5dzvP1n` is the fallback). The migration file in `supabase/database/` is always the deliverable: write it, make it idempotent, **run it myself**, verify the effect. I cannot write n8n credential secrets.
- **Testing n8n:** `execute_workflow` (manual). Only ONE trigger can be enabled per workflow — disable the others.
- **Browser-verify the admin UI:** playwright + static server at the REPO ROOT (node_modules in an old scratchpad; browsers in `%LOCALAPPDATA%\ms-playwright`). Screens are not verified until clicked.

## Architecture invariants (never violate)
- One append-only stream table per aggregate; one writer per stream. Push delivery (DB webhook → n8n) BETWEEN domains — vendor polling (BD snapshots) lives ONLY in the n8n Harvest Worker. Fat events. Idempotent consumers dedup on event_id.
- **Every outbound API call passes the rate-limit gate first.** No raw `fetch()` in adapters. **No row in `api_rate_limits` = DENIED.** ONE exception: the BD schema probe (invalid payload = free).
- **Config is data.** Pillars, identity, character, model params live in SQL — never in code, never in md files.
- **Hard output constraints are code, not prose** (new 2026-07-19) — see learnrules.
- UI renders what the backend serves; it never re-implements backend predicates/enums.
- No secrets in files. Legacy Workflows A (`Sd2dD8Ci9yHhThmG`), B (`RiibWUSoeZgvLs9Q`), C (`EPA725LVP3cb3m7a`) stay live and untouched.

## ▶ RESUME HERE

**M3 generates real drafts.** `m3-generate` is deployed and proven end-to-end: a SourceEnriched article produced `content_items` id 1 (burning_now · 鬼謎東宮 · 184 chars in range · 0 flags · facts all traceable to evidence), and `event_trace` shows one correlation_id spanning SourceEnriched → ContentGenerated.

**Next buildable, in order:**
1. **RAZ-50** — upgrade the existing M3 placeholder consumer (`Am5M5SauJqhZSzVb`, `/webhook/m3-source-consumer`, gen_processed guard) IN PLACE to POST `m3-generate` + Telegram draft ping. Decision recorded: upgrade in place, never a second consumer, or events double-process.
2. **RAZ-51** — end-to-end acceptance: manual M1 trigger → trend → M2 → M3 draft under ONE correlation_id. Today's proof was the standalone-article lineage; the trend leg is still unproven.
3. **RAZ-53 (LAST, needs owner URLs)** — seed competitor + lifestyle reference pages; includes the trend-triggered harvest live-fire.

Also open, not blocking M3: **RAZ-40** (In Progress, admin Content Source CONFIG half) · **RAZ-39** (In Review, one real campaign save still needed) · **RAZ-19** (In Review, awaiting post_metrics accrual) · **RAZ-32/33/34** (In Review, need a 9AM Workflow A run).

## Status by domain

**M0 Infrastructure — COMPLETE.** Backbone: dead_letter, sweep_attempts, content_queue, `event_trace` view (now 4 streams incl. content), hourly sweep. Rate-limit gate in `supabase/functions/m0-infrastructure/` — `guardedFetch` for edge fns + a gate endpoint for n8n. Fail-closed, proven.

**M1 Trend Intelligence — live, NOT publishing.** `m1-trend` edge fn; sources google_trends_daily, youtube, youtube_film; 3 pages. Daily Trigger `bZyOyWkgtzj7ucUY` INACTIVE on purpose. Debt: adapters still bypass guardedFetch (RAZ-54). Open: RAZ-18, RAZ-28, RAZ-35, RAZ-38.

**M2 Content Sources — build COMPLETE** (only RAZ-27 cutover remains, owner-timed).
- `m2-contentsource` modes: `run` · `ingest` · `search` · `search_plan` · `harvest_plan` · `promote`. Scope strings validated (unknown = 400).
- **RAZ-43 v2 (reference harvest):** per-row `cadence` + `next_run_at` + `trigger_rule` + `ref_kind`, unbounded roster. Claiming is atomic in plpgsql — `ref_harvest_claim()` (FOR UPDATE SKIP LOCKED, steps from the STORED next_run_at on the slot grid, walks to the first future slot). `harvest_schedule` dropped — single source of truth. **`harvest_plan` scope "due" CLAIMS AND ADVANCES — it is not a dry run.**
- All 8 harvest platforms field_map VERIFIED against real payloads. Keyword search on 4/8. Articles: RSS feeds + scrape (RAZ-52 seeded and observed).
- `readme.md` rewritten: 6 modes + a 13-step Identity setup section.

**M3 Content Generation — the brain is live.**
- **Config plane, 100% SQL:** `page_identity` (hard rules incl. the no-dash rule, audience, visual, `forbidden_patterns`) · `pillar_catalog` (7 pillars, versioned rows — NEVER updated in place, instruction + principle formula merged, `char_range` in format_hints) · `page_pillar_subscriptions` (weights + cooldown overrides + optional pinned_version) · **Character Brain** (`char_field_catalog` w/ renderer_bands · `char_trait_catalog` 40 DISC · `char_lexicons` 46 shortforms / 50 mild_badwords / 40 localizers · `characters` w/ 5–10 DISC picks trigger-validated · `char_current_state` · `page_character_subscriptions`) · `m3_config` (model, max_tokens, daily cap, material types).
- **Jello seeded** as `is_template=true` — the pattern any of the next 50–100 pages copies.
- **`m3-generate`** (index + service/{types, context, claudeapi, validate, writer}): prefilters → SQL context → ONE Claude call (pillar-or-skip) → **validator** (code-counted char_range + forbidden_patterns → one auto-revise → flags, never silent) → `content_items` + `ContentGenerated`. Claude goes through guardedFetch.
- Guardrail proof (unstaged): fed a politics-adjacent casting article, the model REFUSED it citing the pillar's own rule.
- Drafts are reviewed by reading `content_items` (status `draft`) — the manual edit/shorts/schedule loop is his, by design, for now.

**AR-1 Admin UI** — `admin/` static app (local-only, no deploy, no auth; service_role in gitignored `admin/config.js`). Hardened by the 2026-07-17 review (insert-first saves, in-flight locks, res.ok + shape checks). **Open observation (deliberately unfixed):** the UI reads working-tree `sources.json` but search executes against the DEPLOYED bundle — an edit without redeploy reads as "0 results".

## Rule files changed 2026-07-19 (re-read both)
- **`CLAUDE.md`:** new **"Capturing a lesson"** rule — mistake + fix + *proven by a real run* → notify Raze → propose the rule → on approval append it to the domain's `CLAUDE.md` (domain-specific) or `learnrules.md` (global). Never log an unproven theory; never write the same lesson twice.
- **`learnrules.md`:** new **"Hard output constraints are code, never prose"** section (the 2026-07-19 validator lesson; applies to every generative domain).
- **New directory-scoped pointer files** — `supabase/functions/{m0-infrastructure,m1-trend,m2-contentsource,m3-generate}/CLAUDE.md`. They auto-load when work touches that folder and hold ONLY that domain's invariants + a `## Learned rules` section. Deep knowledge stays in each domain's `readme.md`.

## n8n workflows
- **`2IuURyFgPsYW8wIw` M2 · Harvest Dispatcher** — 06:00 schedule + `/webhook/m2-reference-harvest`.
- **`g358gDdwFoHjeCSL` M2 · Harvest Worker** — ONE execution per job: gate → trigger → poll ×25 → download → ingest; giveup → Cancel Snapshot. Holds no config.
- **`1gZQvoIfZULhdAiC` M2 · Trend Consumer** — ACTIVE.
- **`Am5M5SauJqhZSzVb` M3 · Source Consumer** — placeholder; RAZ-50 upgrades it in place.
- **`FDMb0ugyE1Wu0MWO` M4 placeholder** — consumes ContentGenerated (fired 1s after today's insert).
- **`iajXVmJEhE73y9n5` ZZ · BD Probe + SQL Runner (temp)** — parked back to its normal state after the M3 tests; delete when quora/threads settle.

## Pending OWNER actions
1. Verify legacy patches RAZ-32/33/34 on a 9AM Workflow A run.
2. Provide competitor + lifestyle page URLs for RAZ-53 (the final M2/M3 seed).
3. Optional: quora + threads dataset_ids (both `gd_REPLACE`, self-skip, nothing blocked).

## Database records (`supabase/database/`)
m0_infrastructure · m1_trend · 20260713_m2_source_foundation · m2_manual_search · 20260714_m2_reference_schedule · 20260716_ar1_campaign · 20260716_m0_rate_limit · 20260717_raz26_trend_events_webhook · 20260717_raz25_article_feeds · 20260718_raz43_reference_cadence · 20260719_raz47_m3_tables · 20260719_raz48_pillar_identity_seed · 20260719_raz48b_identity_dash_rule · 20260719_raz57_character_brain · 20260719_raz57_jello_seed · 20260719_raz49_m3_generate — **all applied.**

## Gotchas (hard-won)
- **BD bills per RECORD and keeps collecting after you stop polling.** ALWAYS `limit_per_input`; ALWAYS cancel on giveup. "Still running at timeout" = unbounded spec, NOT a slow platform.
- **A BD probe is free ONLY while the payload is INVALID.** Real calls go gated.
- **DISCOVER jobs are async-only** (112.6s measured, 0 records sync). Only `bd_input=prompt` survives sync.
- **The same dataset returns a DIFFERENT SHAPE per discovery mode** — never inherit a field_map across modes on faith.
- **Every field_map has been wrong the same way:** `title` → account name (1-distinct); keys that don't exist (0/N). All platforms flat.
- **TMDB `watch/providers` results are keyed by COUNTRY** (object, not array).
- **XML/RSS `<guid isPermaLink="false">` parses to an OBJECT** → `[object Object]` dedup collapse; use the fallback chain. `field_map` values may BE a fallback chain — check `Array.isArray` before object branches.
- **`fillUrl` encodeURIComponents every `{placeholder}`** — right for query params, fatal for whole URLs.
- **BD enums are CAPITALIZED.**
- **n8n Postgres `RETURNING` + `ON CONFLICT DO NOTHING` cannot gate anything** (emits success on zero rows). `addNode` has no `executeOnce` — it runs once PER INPUT ITEM. n8n only flushes execution data at the END — poll the DB. `update_workflow` descriptions cap at 255 chars.
- **A truncated model response looks like a parse bug.** Unparseable JSON from Claude = raise `max_tokens` in `m3_config` first (config change, no redeploy).
- Supabase bundles only *imported* files — JSON needs `with { type: "json" }`. Validate `sources.json` parses BEFORE deploy.
- **PowerShell 5.1 `ConvertTo-Json` emits INVALID JSON on emoji**; PS chokes on inline node `-e` with braces — write a file to scratchpad. PostgREST filter values containing `/` must be URL-encoded.
- Git is not on PATH: `$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe` (glob newest).
- IDE "Cannot find name 'Deno'" diagnostics are cosmetic — the deploy bundler is the real type-check.
- 40 `tmdb_*` + 1 `bd_snapchat` legacy events in `source_events` are harmless — append-only, leave them.

## Repo state
Working tree ahead of Raze's last push. Uncommitted since then: everything above plus M3 in full (`supabase/functions/m3-generate/`, 6 SQL files), the M2 RAZ-43 v2 rewrite + readme, 4 domain `CLAUDE.md` pointers, rule updates (`CLAUDE.md`, `learnrules.md`), `temporaryreview/` (3 comparison files), and this SESSION.md. He commits himself.
