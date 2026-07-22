# Drawing rules — how Claude draws Content OS flows in Eraser

Binding rules for every Content OS data/event/flow diagram. Replaces the old
per-pipeline mermaid docs. When a task involves drawing, mapping, or editing a
flow, read this first and follow it exactly. The canonical diagrams live in
**Eraser** (workspace file `review — M1→M3 AS-IS flow`, id `EtP0l1CYqAys3GJPso5v`);
this repo doc is the law they obey, not a second copy of them.

## 1. Surface & tooling (two-way with the owner)
- Draw in **Eraser via MCP**, as **DSL diagrams** (`diagramType: flowchart-diagram`),
  never freehand. DSL is the only form that is **two-way**: the owner edits it in
  the app (double-click → edit code) and Claude re-reads it via the MCP.
  Freehand canvas strokes are **invisible to the MCP** — if the owner sketches
  freehand, ask for a screenshot; do not claim to have read it.
- Author a new diagram with `manually_create_diagram(fileId, …)`. Apply the
  owner's natural-language edits with `update_diagram`; only re-emit full DSL with
  `manually_update_diagram` for a structural rewrite.
- After creating/updating, **export a PNG and view it** to confirm it rendered
  (no DSL errors, layout sane) before handing over the link. Share the
  `diagramUrl`, never the raw image URL.
- Keep **AS-IS** and **TARGET** as separate diagrams in the same file, side by
  side, so the gap is visible.

## 2. Layout law — domains are columns, sub-features are stacked lanes
This is what makes a complex flow human-readable and debuggable at a glance.
- **Domains = columns, LEFT → RIGHT.** Each domain is one bordered column
  (`M1 …`, `M2 …`, … through `M9`), in pipeline order. Set `direction: right`.
- **Sub-features = horizontal LANES stacked top→down.** Each lane is a
  left→right flow line running across the domains it touches. A domain's TOP lane
  is its config / existing data / primary feature; each lane BELOW is one
  sub-feature (e.g. M0 = lane "observe" + lane "rate limit"; a domain with three
  sub-features is three stacked lanes). A complex domain is a TALL stack of lanes,
  never a scattered blob — this is how one domain stays well-documented.
- **Number the lanes so they survive any tool that can't draw true swimlanes.**
  The domain is `M1`, `M2`, … (its top node = primary feature); its sub-features
  are `M1.1`, `M1.2`, … streaming DOWNWARD under it. Real example — M0: `M0`
  infrastructure, `M0.1` observe, `M0.2` rate-limit. A forward edge then reads
  unambiguously as `M1.2 → M2.1`, even if the renderer places boxes imperfectly.
- **Cross-domain edges go FORWARD only, one step at a time.** A sub-feature in
  domain N connects to a feature in domain N+1 (or later) — **never back to an
  earlier domain**. No backward edges, no cycles: data streams forward toward the
  terminal domains (7/8/9). Domain 3 can NEVER connect to domain 1. This mirrors
  the DDD event flow (acyclic, forward) and is exactly what makes a break easy to
  locate — you scan the one lane, left to right.
- **Every cross-domain edge carries the ID spine** (§3): label a boundary-crossing
  lane with the ids it carries, so a flow is traceable end to end.
- Colour convention: edge fn = rectangle · stream table = cylinder (`icon: database`)
  · SQL config read = `document`, colour `orange` · decision = diamond ·
  break/wrong-flow = `octagon`, colour `red` · fix / resolves-a-break =
  `parallelogram`, colour `green` · domain groups keep a stable colour
  (M1 blue · M2 green · M3 purple · M4 gray).

## 3. The ID-spine law (DDD traceability — non-negotiable)
Every flow is **connected by an unbroken ID**. From the head of the flow to
content generation and onto the output, **every hop carries the spine**:
`correlation_id · trend_signal_id · page_id · keywords`.
- `correlation_id` traces the **flow**; `trend_signal_id` traces **which trend**
  produced the content (grain = **one per campaign run**, minted at M1 on the
  campaign's scheduled fire: POST → GET → `trend_signal_id`).
- `page_id` is **one value end-to-end** — no per-domain aliases (the drift that
  killed the trend path: `jello_topmovie_svs` ≠ `jello`).
- Label the spine on the connecting edges, and show it stamped onto the final
  `content_items` / `content_events` so a draft is traceable back to its trend.
- A hop that drops the spine is drawn as a **break**, not glossed over.

## 4. Progressive accumulation (why the flow is drawn as one growing payload)
Data is **compiled stage by stage**, not handed off in thin slices:
- **M1** stamps the trend signal (spine + region/topic).
- **M2** pulls **for that trend** and folds **all sources** (manual keyword search
  + auto scrape, every platform through its **adapter → normalize** into one
  common typed record) onto the same payload.
- **M3** receives one **complete compiled brief** = carried material **+**
  M3-owned SQL reads (identity / pillars / dedup memory), then generates.
- Boundary that keeps it DDD-clean: the **event carries material + lineage**;
  **rules/identity/dedup stay each domain's own reads**, assembled at M3 — never
  pushed through the event.

## 5. Adapter / normalization layer (draw it, don't hide it)
Per-platform difference is real and must be visible:
- Each platform declares its own `field_map` in `trendsource.json` (M1) /
  `sources.json` (M2); the `type`-based adapter (`api`/`rss`/`scrape`/`brightdata`)
  fetches it; `normalize.ts` maps it → one common shape. Draw this as
  **platform adapters → normalize service → common typed record**, not a single
  opaque box.
- Platforms differ in capability (YouTube: recent/hot/new-upload/best-engagement;
  Google Trends: search volume; social: keyword search vs profile harvest). The
  normalized **freshness/signal tag** (`recent/trend/hot`) is the field that
  unifies them for M3 — show where it is stamped.

## 6. Honesty
- Draw **AS-IS from live-verified state** (DB triggers, config tables, deployed
  code), not from stale docs. Mark anything unverified as such.
- TARGET is the owner's intent; the owner reviews and edits it in Eraser. Do not
  build from a TARGET until it is locked and its gap is written to Linear
  (Linear-before-code).
