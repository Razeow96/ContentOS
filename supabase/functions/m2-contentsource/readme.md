# m2-contentsource — M2 Content Sources Edge Function

Turns reference **material** into `SourceEnriched` events (contract: *SourceEnriched v1*). Material, not signal — this is what a post is built *from*, given a topic. Mirrors the `m1-trend` architecture: heavy logic here, n8n only schedules/orchestrates and reports.

## Flow

```
n8n (schedule / trend webhook / Bright Data snapshot)
  → POST this function
      run mode:    catalog + page_material_sources → API/RSS adapters → normalize → dedup → fan-out → source_events
      ingest mode: raw items handed in (Bright Data / scrape) → normalize → dedup → fan-out → source_events
  → INSERT into source_events fires the Supabase webhook → downstream (M3+)
```

## Three invocation modes (POST body)

- **`{ "mode": "run" }`** — scheduled or trend-driven. Optional `"trend": <TrendDetected payload>` carries correlation/causation for enrichment (RAZ-26). Runs `api`/`rss` catalog sources subscribed via `page_material_sources`.
- **`{ "mode": "ingest", "source": "reference_harvest", "pages": ["p1"], "items": [ ...raw... ], "trigger": null }`** — n8n hands in already-fetched raw items (Bright Data reference harvest RAZ-36, scrape-mode articles RAZ-25). Function only normalizes → dedup → emit.
- **`{ "mode": "search", "keyword": "...", "sink": "events"|"manual", "sources": [...], "pages": [...], "ai_assist": bool }`** — keyword fan-out. `sink="events"` = autonomous, dedups + fans out + writes `source_events` (RAZ-26). `sink="manual"` = isolated store `manual_search_results`, **no dedup, no fan-out, never source_events** (RAZ-37). Omit `sources` and only cheap in-function sources run; Bright Data must be named explicitly.

## Layout

- `index.ts` — entry point, run/ingest branching.
- `service/types.ts` — SourceEnriched + adapter types (must match the contract).
- `service/normalize.ts` — raw → RawMaterial (via field_map) → fan-out to SourceEnriched.
- `service/writer.ts` — insert into `source_events`.
- `config/config.ts` — load catalog + `page_material_sources` (gated by `page_source_settings`), build jobs, ingest job.
- `config/fieldmap.ts` — `getPath` / `mapField` helpers.
- `config/dedup.ts` — freshness via `source_material` (unique `dedup_key`,`window_day`).
- `adapters/api.ts` — JSON REST (TMDB, listings). Auth via `auth_ref` (query or bearer).
- `adapters/rss.ts` — RSS/XML feed parse.
- `adapters/brightdata.ts` — ONE config-driven adapter for every Bright Data scraper.
- `sources.json` — the material catalog. **Data only** — every "why" lives in this file.

## The catalog contract (sources.json)

`field_map` keys are OUR SourceEnriched fields; values are the dot-path into the source's response for one item. Targets: `title` (required), `summary`, `entities`, `image_url`, `media`, `url`, `lang`, `region`, `country`, `topic_tags`, `published_at`, `engagement`, `external_id`, `kind`. Literals wrap as `{"const": "..."}`. `image_base` prefixes relative image paths (TMDB `poster_path`). `kind` can also arrive per-subscription via a `page_material_sources` param.

### ⚠️ external_id is load-bearing — verify it against a real payload

`dedup.ts` builds its key as `source|external_id`. A field_map path that **doesn't exist** in the real payload yields ONE shared key per source per day, so everything after the first item is silently dropped as a duplicate on the `sink="events"` path.

This bit us for real (2026-07-16): all five AI scrapers mapped `external_id → response_id`, a field none of them return. Every AI answer keyed to `bd_perplexity|`, meaning only the first trend topic each day would have emitted. Real AI keys are `prompt`, `answer_text`, `url`, `citations`, `sources`, `timestamp`, `index` — so they now map `external_id → prompt` (= one answer per keyword per day, the grain we want). **Never trust a source on the events path until external_id resolves against real output.**

## Bright Data (`type: "brightdata"`)

Sync endpoint `POST /datasets/v3/scrape?dataset_id=gd_...`, body `{"input":[...]}` — **not** the bare array `/trigger` takes. `dataset_id` comes from the dashboard (`/cp/datasets`); `gd_REPLACE_*` placeholders error defensively so one unset source never breaks a run. Bright Data is **OPT-IN**: it only runs when named in the request's `sources`, keeping the default TMDB search fast and free.

Two families:

- **`bd_input: "prompt"`** — AI-search. The keyword becomes the prompt. `bd_url` is **required**: every AI scraper declares `url` (the chat surface it drives) as a Required input alongside `prompt`; omit it and the scrape fails. All five are proven live — **Google AI Mode ~19s is fastest by 4x, prefer it as the default**; Perplexity ~78s leaves only ~30s of headroom against the 110s budget.
- **`bd_input: "url"`** — social. Resolves `page_reference_sources` rows matching `platform`, then keyword-filters. **Async-only**: social scrapes reliably exceed the sync window (proven with Facebook >110s), so the in-function path fail-fast guards them. They run via the n8n harvest → `ingest` path (RAZ-36).

### ⚠️ collect vs discover — the trap

One `gd_` dataset = one scraper **GROUP** (e.g. "Instagram - Posts"). Each group exposes **both** `collect by URL` (you hand it exact item URLs — a tweet, a video, a pin) **and** `discover by X` (you hand it a seed like a profile and it FINDS the items). Same `dataset_id`; the mode is a query param: `&type=discover_new&discover_by=<method>`.

Our model is **profile ref_url → that page's recent posts**, which is **discover** on every platform except Facebook — `Facebook - Pages Posts by Profile URL` is natively profile→posts *in collect mode*. That's why it worked first try and set a misleading precedent for the rest.

So a `bd_*` social entry needs the **Posts** group's dataset_id (not the Profiles group — that returns follower/bio metadata) plus `bd_discover_by`. `bd_discover_by` is confirmed against the dashboard for instagram/tiktok/linkedin; the rest are label-inferred and want a check against Bright Data's API docs on first real harvest.

Adding a platform = **one catalog entry, zero code** — the adapter names no platform. Keep it that way.

## Config lives in Supabase (add a source = insert a row, no redeploy)

- `page_source_settings` — per-page gate (`sources_enabled`).
- `page_material_sources` — which api/rss catalog sources run per page (+ params).
- `page_reference_sources` — reference pages per page (platform, url, strategy, window, cap) — RAZ-36.
- `page_article_sources` — article feeds/sites per page (mode rss|scrape) — RAZ-25.

## Deploy

```
supabase functions deploy m2-contentsource
```

Secrets (Supabase): `TMDB_API_KEY`, `BRIGHTDATA_API_KEY`, optional `ANTHROPIC_API_KEY` (AI-assist), plus auto-injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

**Gotcha:** Supabase bundles only *imported* files — a JSON catalog must be imported as `import x from "./x.json" with { type: "json" }` or it won't ship. Deno isn't installed locally; type-checking happens at deploy (the bundler).

## Status (2026-07-16)

**Deployed and live.** api/rss/ingest/brightdata adapters + run/ingest/search modes all in. TMDB search verified (titles only). Bright Data: AI-search family (5) proven live end-to-end; social wired for 10 platforms but **unproven** — it needs the RAZ-36 n8n harvest workflow, which is the next build. `bd_quora` / `bd_threads` still need dataset_ids.

Open: RAZ-36 (async harvest), RAZ-25 (article rss/scrape), RAZ-24 (listings), promote-bridge for `manual_search_results`.
