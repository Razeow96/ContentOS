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

## Two invocation modes (POST body)

- **`{ "mode": "run" }`** — scheduled or trend-driven. Optional `"trend": <TrendDetected payload>` carries correlation/causation for enrichment (RAZ-26). Runs `api`/`rss` catalog sources subscribed via `page_material_sources`.
- **`{ "mode": "ingest", "source": "reference_harvest", "pages": ["p1"], "items": [ ...raw... ], "trigger": null }`** — n8n hands in already-fetched raw items (Bright Data reference harvest RAZ-36, scrape-mode articles RAZ-25). Function only normalizes → dedup → emit.

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
- `sources.json` — the material catalog (api/rss/ingest source definitions + field_maps).

## Config lives in Supabase (add a source = insert a row, no redeploy)

- `page_source_settings` — per-page gate (`sources_enabled`).
- `page_material_sources` — which api/rss catalog sources run per page (+ params).
- `page_reference_sources` — reference pages per page (platform, url, strategy, window, cap) — RAZ-36.
- `page_article_sources` — article feeds/sites per page (mode rss|scrape) — RAZ-25.

## Deploy

```
supabase functions deploy m2-contentsource
```

Secrets needed (Supabase): `TMDB_API_KEY` (adapter auth_ref "TMDB API key"), plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (auto-injected). Bright Data runs in n8n, not here.

## Status

Scaffold + core + api/rss adapters + ingest path complete (RAZ-22). **Not yet deployed or smoke-tested.** Next: flesh TMDB (RAZ-23), listings (RAZ-24), reference-harvest field_map + n8n orchestration (RAZ-36), article rss/scrape wiring (RAZ-25).
