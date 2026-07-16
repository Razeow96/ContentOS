/*
 * normalize.ts
 * Turns raw source items into RawMaterial records, then fans out to SourceEnriched
 * events (one per subscribing page). Applies the source field_map.
 */
import { mapField } from "../config/fieldmap.ts";
import type { MaterialJob, RawMaterial, SourceEnriched } from "./types.ts";

function s(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v);
}

export function normalize(job: MaterialJob, items: unknown[]): RawMaterial[] {
  const src = job.source;
  const fm = src.field_map ?? {};
  const out: RawMaterial[] = [];
  for (const it of items) {
    const title = mapField(it, fm.title);
    if (title === undefined || title === null || String(title).trim() === "") continue;

    // relative image paths (e.g. TMDB poster_path "/x.jpg") get the source's image_base prefix
    let image_url = s(mapField(it, fm.image_url));
    if (image_url && src.image_base && image_url.startsWith("/")) image_url = src.image_base + image_url;

    out.push({
      raw_material_id: crypto.randomUUID(),
      source: src.name,
      material_type: src.material_type,
      // kind: static on the source, else per-subscription param, else field-mapped
      kind: src.kind ?? job.params.kind ?? (fm.kind ? s(mapField(it, fm.kind)) : null),
      tier: src.tier ?? "material",
      title: String(title),
      summary: s(mapField(it, fm.summary)),
      entities: (mapField(it, fm.entities) as Record<string, unknown> | null) ?? null,
      image_url,
      media: (mapField(it, fm.media) as unknown[] | null) ?? null,
      url: s(mapField(it, fm.url)),
      lang: s(mapField(it, fm.lang)) ?? job.params.language ?? null,
      region: s(mapField(it, fm.region)) ?? job.params.region ?? null,
      country: s(mapField(it, fm.country)) ?? job.params.country ?? null,
      topic_tags: (mapField(it, fm.topic_tags) as string[] | null) ?? null,
      published_at: s(mapField(it, fm.published_at)),
      engagement: (mapField(it, fm.engagement) as Record<string, unknown> | null) ?? null,
      enrichment: null,
      external_id: s(mapField(it, fm.external_id)),
      raw: it,
    });
  }
  return out;
}

// Sum the numeric values of an engagement object ({likes, comments, shares} -> 15).
// Safe ONLY because ranking happens within ONE reference page = one platform. Never
// compare these across platforms (views != searches != likes) — see CLAUDE.md.
function engagementScore(m: RawMaterial): number {
  const e = m.engagement;
  if (!e || typeof e !== "object") return 0;
  let total = 0;
  for (const v of Object.values(e)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function ts(m: RawMaterial): number {
  const t = m.published_at ? Date.parse(m.published_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

// RAZ-36 per-ref selection (owner-confirmed 2026-07-13):
//   latest_n        -> newest first, take cap.
//   best_performing -> keep the window, rank by engagement, take cap.
// Applied AFTER normalize (so it reads mapped published_at/engagement) and BEFORE
// dedup, so the dedup/emit path only ever sees the posts we actually chose.
// Scrapers that take a post-count input already cap themselves; this also covers
// the ones that don't, so cap means the same thing on every platform.
export function applyStrategy(
  materials: RawMaterial[],
  strategy?: string | null,
  window_days?: number | null,
  cap?: number | null,
): RawMaterial[] {
  let out = materials;

  if (strategy === "best_performing") {
    if (window_days && window_days > 0) {
      const cutoff = Date.now() - window_days * 86_400_000;
      // Undated posts are dropped here on purpose: an unknown date can't be shown
      // to fall inside the window, and silently keeping them would let stale posts
      // win on engagement alone.
      out = out.filter((m) => ts(m) >= cutoff);
    }
    out = [...out].sort((a, b) => engagementScore(b) - engagementScore(a));
  } else {
    out = [...out].sort((a, b) => ts(b) - ts(a));
  }

  return cap && cap > 0 ? out.slice(0, cap) : out;
}

export function fanOut(job: MaterialJob, materials: RawMaterial[]): SourceEnriched[] {
  const events: SourceEnriched[] = [];
  const trig = job.trigger;
  for (const m of materials) {
    for (const sub of job.subscribers) {
      events.push({
        ...m,
        page: sub.page_id,
        event_type: "SourceEnriched",
        correlation_id: trig?.correlation_id ?? crypto.randomUUID(),
        causation_id: trig?.causation_id ?? null,
      });
    }
  }
  return events;
}
