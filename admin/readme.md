# Admin UI (AR-1) — config plane

Operator UI over the `page_*` config tables. **Additional requirement**, not ADR-001 scope. Local-only: no auth, no deploy, no build step.

## Run

```
cd <repo root>
python -m http.server 8765
```

Then open **http://localhost:8765/admin/**.

**Serve from the repo root, not from `admin/`**, and don't open `index.html` via `file://`. The app fetches the real `supabase/functions/m1-trend/trendsource.json` off disk at `../supabase/...` — that path only resolves from the root, and `file://` blocks the fetch outright.

## config.js

Copy `config.example.js` → `config.js` (gitignored) and fill in. **It needs the `service_role` key**: the `page_*` tables are RLS-protected, so the anon key silently reads back zero rows and cannot write at all.

That key bypasses RLS, which is the whole reason this app is local-only and never deployed. Don't paste it anywhere else.

## Why it reads trendsource.json off disk

The platform list, the per-platform fields and their defaults are **derived from the real catalog file** — the same file the edge function bundles at deploy. No second copy to drift, and no `catalog` endpoint needed on M1 (RAZ-39 is explicitly "no M1 function changes"). The tradeoff is the static-server requirement above.

## Honest fields — why the form hides things

`page_trend_sources` has seven config columns, but **M1 does not read all of them for every source**. The form derives which are live from each source's actual `url` template:

- **fetch** — the placeholder is in the url, so it changes what gets pulled.
- **label** — not in the url, but `normalize` stamps it onto the TrendDetected event.
- **dead** — the engine never reads it for this source; not shown.

As deployed today:

| source | live | dead |
|---|---|---|
| `google_trends_daily` | region *(fetch)*, language, country *(label)* | chart, max_results, category, keywords |
| `youtube` | region, language, chart, max_results *(fetch)*, country *(label)* | category, keywords |
| `youtube_film` | region, language, max_results *(fetch)*, country *(label)* | chart, category, keywords |

Two things worth knowing:

- **`category` and `keywords` are dead columns for every source.** M1 fills those event fields from the *platform's response* via `field_map`, never from the config row. Setting them changes nothing.
- **`chart` is dead for `youtube_film`** — its url hardcodes `chart=mostPopular`, so there's no placeholder to fill. Live for `youtube` only.

This is derived, not hardcoded, so it stays correct if `trendsource.json` changes.

## Campaigns

A campaign is a UI-level named group of config rows — one row per ticked page, tagged with `campaign`. **The engines are unaware of it**; it's grouping for the operator. Needs the `campaign` column (see the in-app banner for the SQL); until then campaign create/edit is disabled and everything else works.

Saving replaces the campaign's rows wholesale (delete + insert). Config rows carry no state worth preserving, and it keeps "what you see is what's stored" literally true.

Rows predating campaigns show under **Ungrouped**, read-only — grouping them automatically would be a guess.

## Screens

- **Trend** (RAZ-39) — gates, campaigns, read-only trends feed.
- **Content Source** (RAZ-40) — search + review half shipped (manual keyword search, promote/discard); config half (adapter board, campaign tabs, gates, run-now) in progress.
