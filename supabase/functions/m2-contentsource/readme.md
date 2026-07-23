# m2-contentsource — M2 Content Sources Edge Function

Turns reference **material** into `SourceEnriched` events (contract: *SourceEnriched v1*, Rule 3 amended 2026-07-18: text inspiration-only / media reusable inside transformative composition). Material, not signal — this is what a post is built *from*, given a topic. Mirrors the `m1-trend` architecture: heavy logic here, n8n only schedules/orchestrates and reports.

## Flow

```
n8n (schedule / trend webhook / Bright Data snapshot / manual tool)
  → POST this function
      run mode:     catalog + page_material_sources + page_article_sources → adapters → normalize → dedup → fan-out → source_events
      ingest mode:  raw items handed in (BD harvest / scrape) → normalize → [strategy] → dedup → fan-out → source_events
  → INSERT into source_events fires the Supabase webhook → downstream (M3+)
```

## Six invocation modes (POST body)

- **`{ "mode": "run" }`** — scheduled or trend-driven. Optional `"trend": <TrendDetected payload>` carries correlation/causation (RAZ-26). Runs `api`/`rss` catalog sources subscribed via `page_material_sources` + article feeds from `page_article_sources` (RAZ-25 — rss parsed in-function; scrape via Web Unlocker).
- **`{ "mode": "ingest", "source": "bd_facebook", "pages": ["p1"], "items": [...], "strategy": "...", "window_days": n, "cap": n, "ref_kind": "competitor"|"lifestyle", "trigger": {...}|null }`** — n8n hands in already-fetched raw items (BD reference harvest RAZ-36/43, scrape articles). Normalize → applyStrategy → dedup → emit. `ref_kind` is validated against the contract enum (invalid echo surfaced in errors, never written); `trigger` carries trend lineage into the events.
- **`{ "mode": "search", "keyword": "...", "sink": "events"|"manual", "sources": [...], "pages": [...], "ai_assist": bool }`** — keyword fan-out. `sink="events"` = autonomous (RAZ-26); `sink="manual"` = isolated `manual_search_results`, **no dedup, no fan-out, never source_events** (RAZ-37). Bright Data is OPT-IN by name.
- **`{ "mode": "search_plan", "keyword": "...", "sources": [...], "cap": n, "sink": ..., "ai_assist": bool }`** — READ-ONLY async twin of search for BD keyword DISCOVERY (can't fit the sync budget). Hands n8n ready-to-call `/trigger` jobs; worker echoes `sink`/`keyword` back into `ingest`.
- **`{ "mode": "promote", "ids": [...], "pages": [...] }`** — RAZ-37. The ONLY bridge out of `manual_search_results`: operator-chosen rows → SourceEnriched. Human-initiated: fresh correlation_id, causation null.
- **`{ "mode": "harvest_plan", "scope": "due"|"daily"|"all"|"triggered", "ref_ids": [1,2], "pages": [...], "trend": {...} }`** — RAZ-36/RAZ-43. ⚠ scope `due` (alias `daily`) **claims and advances** due rows atomically via `ref_harvest_claim()` — NOT a dry run; each call consumes the due slots it returns. `all`/`ref_ids` are read-only; `triggered` is read-only and REQUIRES `pages`+`trend`. Unknown scope = 400. Returns `{ scope, jobs, skipped, refs_considered, advanced }`.

## Trend-compiled pull (RAZ-73, 2026-07-23)

The `trend_events` DB-webhook consumer (`trendConsume`) no longer runs a thin keyword `search` — it runs `runTrendCompile`: **one trend keyword → ONE compiled `SourceEnriched` v3** (`source: trend_compiled`, `material_type: compiled`, `tier: material`) carrying the full spine + `keywords` + two legs:

- **manual** — free `search: true` catalog sources (`tmdb_search` today; a new non-BD search entry auto-joins).
- **auto** — the page's OWN `page_article_sources` feeds/scrapes, **keyword-filtered** (CJK-safe substring, then all-tokens match), plus BD AI-search (sync prompt family) ONLY for pages naming sources in `page_source_settings.trend_bd_sources` (paid → opt-in, NULL = none).

Each item is freshness-tagged from its source's `freshness` capability tag (`recent|trend|hot`, per catalog entry), deduped via `source_material` (cap-aware: claims stop at the leg cap so capped-out items aren't burned), trimmed (`summary_max`, per-item `raw` dropped — many items per event), and capped (`manual_cap`/`auto_cap`). Zero items = `no_material`, nothing emitted. Knobs live in `sources.json → trend_pull`.

Guards proven live 2026-07-23:
- **Only keyword-grade signals compile** (`trend_pull.keyword_signal_types`, i.e. `search_trend`). Title-grade topics (youtube `trending_rank` = raw video titles) skip cheaply — 50 of them once did 100+ feed fetches for zero material and exhausted the Yahoo + LTN daily record budgets.
- **`feed_cache` table (TTL `feed_cache_ttl_min`)** — a campaign burst fires one consumer per trend; feeds are fetched once per window, reused across the burst. Trend path only; the daily run-mode pull stays direct.

M3 side: `material_type: "compiled"` is enabled in `m3_config` generation.material_types; the compiled brief renders `sources_manual`/`sources_auto` with freshness as the pillar-priority signal, inspiration-tier items are context-only, and evidence/media_refs are built per item. First proven run: campaign `0e73843b` → 6 放映週報 articles → draft `content_items` 18 (獨奏者之舞).

## harvest_plan + the scheduler (RAZ-43, revised 2026-07-19)

n8n **cannot read `sources.json`** (bundled here), so the function joins ref rows against the catalog and hands n8n **ready-to-execute jobs** (`trigger_url` formed, `inputs` built, `page_id`/`ref_kind`/`trigger` to echo back). n8n holds zero config, makes zero decisions.

**Scheduler state lives in SQL** ("one dumb ticker, smart table"): per-row `cadence` (daily|weekly|monthly, NULL = on-demand) + `next_run_at` (DEFAULT now(), CHECK-coupled to cadence so a scheduled row can never be born dead). The due path is `ref_harvest_claim()` (plpgsql, `api_gate_acquire` precedent): gate-joined, FOR UPDATE SKIP LOCKED (no race double-spend), steps from the STORED `next_run_at` on the slot grid (no drift; a 06:00 slot stays 06:00), WHILE-walks overdue rows to the first future slot (no catch-up spam), claim+advance in one transaction (no partial states). `harvest_schedule` is DROPPED — cadence is the only truth.

Jobs carry `strategy`/`window_days`/`cap`/`strategy_supported` — **both `latest_n` and `best_performing` are implemented** (applyStrategy in normalize.ts: window filter drops undated posts, ranks by summed likes+comments+shares; views excluded per contract Rule 4 — never cross-platform). `cap` also caps the DISCOVER phase via `limit_per_input` (uncapped discover bills per record — learned 2026-07-16). `skipped` is returned, never swallowed. A ref only harvests if its page has `page_source_settings.sources_enabled = true`.

## Layout

- `index.ts` — entry, six-mode branching, `claimDueRefs`, `process` pipeline.
- `service/types.ts` — SourceEnriched + RefRow/HarvestJob/SearchJob types (must match the contract).
- `service/normalize.ts` — raw → RawMaterial (field_map) → applyStrategy → fan-out.
- `service/writer.ts` — `source_events` insert + `manual_search_results` insert.
- `service/manuel_search_ai.ts` — Claude relevance-ranking for ai_assist (defensive: failure returns input unchanged).
- `config/config.ts` — catalog + subscriptions loaders (gated), job builders, search/harvest plans.
- `config/fieldmap.ts` — `getPath`/`mapField` (fallback chains + composite specs; deliberately NOT shared with m1 — bounded contexts own their mappers).
- `config/dedup.ts` — freshness via `source_material` (unique `dedup_key`,`window_day`).
- `adapters/api.ts` — JSON REST (TMDB, watch-providers enrichment RAZ-24). Auth query|bearer.
- `adapters/rss.ts` — RSS/XML parse (through guardedFetch).
- `adapters/scrape.ts` — no-feed articles via BD Web Unlocker, Open-Graph extraction (RAZ-25).
- `adapters/brightdata.ts` — ONE config-driven adapter for every BD scraper (sync prompt family only; url/keyword discover are async-only via n8n).
- `sources.json` — the material catalog. **Data only.**
- All third-party calls go through **guardedFetch** (m0 rate-limit gate: no budget row = denied; ledger = spend audit).

## The catalog contract (sources.json)

`field_map` keys are OUR SourceEnriched fields; values are dot-paths into the source's response. Targets: `title` (required), `summary`, `entities`, `image_url`, `media`, `url`, `lang`, `region`, `country`, `topic_tags`, `published_at`, `engagement`, `external_id`, `kind`. Literals wrap as `{"const": "..."}`. `image_base` prefixes relative paths (TMDB `poster_path`). Fallback chains (`["images.0","video_thumbnail"]`) and composite specs (`engagement: {likes:..., comments:...}`) supported.

### ⚠️ Verify a field_map against a REAL payload, not a plausible one

Every field_map bug so far was a plausible key the platform doesn't return, failing *silently*. Facebook (2026-07-16): `image_url` → `post_external_image` (link-preview, null on image posts — real one is `post_image`); `title` → `page_name` (the page, not the post); `hashtags` unmapped. "The scrape returned rows" is not verification — `select payload->'raw'` from `source_events` and check field by field.

### ⚠️ external_id is load-bearing

`dedup.ts` keys on `source|external_id`. A path that doesn't exist in the real payload yields ONE shared key per source per day — everything after the first item silently drops as duplicate. Bit us 2026-07-16 (all five AI scrapers mapped `response_id`, which none return → now `external_id → prompt`). **Never trust a source on the events path until external_id resolves against real output.**

## Bright Data (`type: "brightdata"`)

Sync endpoint `POST /datasets/v3/scrape?dataset_id=gd_...`, body `{"input":[...]}`. `gd_REPLACE_*` placeholders error defensively. OPT-IN by name.

- **`bd_input: "prompt"`** — AI-search, sync-capable. `bd_url` required. All five proven; **Google AI Mode ~19s is 4x fastest — default choice**; Perplexity ~78s.
- **`bd_input: "url" | "keyword"`** — social/discover. **Async-only** (proven >110s): fail-fast guarded in the sync path; they run via harvest_plan/search_plan → Dispatcher → Worker → ingest.

### ⚠️ collect vs discover — the trap

One `gd_` dataset = one scraper GROUP exposing both `collect by URL` and `discover by X` (query param `&type=discover_new&discover_by=<method>`). Our model (profile ref_url → recent posts) is **discover** everywhere except Facebook (natively profile→posts in collect mode — a misleading first precedent). A `bd_*` social entry needs the **Posts** group's dataset_id + `bd_discover_by`. Adding a platform = one catalog entry, zero code.

## Config lives in Supabase (add = insert a row, no redeploy)

- `page_source_settings` — per-page gate (`sources_enabled`).
- `page_material_sources` — api/rss catalog sources per page (+ params).
- `page_reference_sources` — reference pages per page: platform, ref_url, strategy, window_days, cap, **cadence, next_run_at, trigger_rule, ref_kind (competitor|lifestyle)** — RAZ-36/43.
- `page_article_sources` — article feeds/sites per page (mode rss|scrape) — RAZ-25. Live TW set for jello (RAZ-52): 自由娛樂 · Yahoo奇摩娛樂 · Yahoo奇摩電影 · 放映週報 (rss); chinatimes/TVBS/SETN/DailyView recorded as scrape-disabled (no public RSS).
- `api_rate_limits` — the spend gate: **no row for a hostname = DENIED**; adding the row IS the approval.

## Identity setup — creating a character (Character Brain, RAZ-57)

M3-owned config module (`char_*` tables), documented here as the operator guide. A page's voice = one character; the page subscribes to it. `char_field_catalog` defines every field below (types, constraints, interview questions, renderer bands) — a UI or Q&A flow renders from it.

**To create a complete character, fill:**

| # | Field | Rule |
|---|---|---|
| 1 | `char_key` | stable slug, e.g. `jello` |
| 2 | `name` / `display_name` | full name / what followers call them |
| 3 | `gender`, `age`, `birth_place`, `current_city`, `education` | profile basics (optional but recommended) |
| 4 | `disc_picks` | **5–10 traits** from `char_trait_catalog` (40 DISC traits, D/I/S/C × 10) — invalid trait = rejected by trigger |
| 5 | `speaking_language` | e.g. `zh-TW` |
| 6 | `slang_level` | `none · low · medium · high · extreme` — governs injection from the three shared lexicons (`char_lexicons`: 46 shortforms · 50 mild_badwords · 40 localizers). Badwords only at ≥ medium AND where pillar register allows; **page hard rules always win** |
| 7 | `voice_tone_energy` | `low · medium · high · very_high` |
| 8 | `background_story` | one paragraph, ≈300 words (≤1200 chars) — this is the canon; the AI may never invent new life facts |
| 9 | `skills` | up to 3 titles |
| 10 | `interests` | up to 3 titles |
| 11 | `is_template` | `true` = clone source for future characters |
| 12 | **initial state** | one `char_current_state` row: `mood` (low→very_high) + optional note — the per-day variance driver |
| 13 | **subscription** | one `page_character_subscriptions` row: page_id → char_key (one active per page) |

Fastest path for a new page: clone a template (`insert … select` from an `is_template=true` row), tweak fields 2–10, add state + subscription. Reference filled example: character `jello` v1 (seed: `supabase/database/20260719_raz57_jello_seed.sql`).

## Deploy

```
supabase functions deploy m2-contentsource
```

Secrets (Supabase): `TMDB_API_KEY`, `BRIGHTDATA_API_KEY`, `ANTHROPIC_API_KEY` (AI-assist), plus auto-injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

**Gotcha:** Supabase bundles only *imported* files — a JSON catalog must be imported as `import x from "./x.json" with { type: "json" }` or it won't ship. Deno isn't installed locally; type-checking happens at deploy.

## Status (2026-07-19)

**Deployed and live — all M2 build issues Done** (RAZ-20…26, 36, 37, 42, 43, 52, 57). Six modes in production. TW article feeds flowing (106 jello events on first pull, cross-feed dedup verified). Reference harvest v2: atomic claim scheduler proven (slot-grid restore + replay + typo-400 all observed). Character Brain seeded (40 traits, 136 lexicon entries, 15-field catalog, jello = character/template #1). Post-review hardening 2026-07-19: 10 findings fixed (see RAZ-43 comment).

Open: RAZ-27 (shadow verification vs Workflow A + cutover — owner-timed) · `bd_quora`/`bd_threads` dataset_ids · trend-triggered pull live-fire lands with RAZ-53 seeding.
