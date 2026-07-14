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
