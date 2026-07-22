// m3-generate · writers (RAZ-49). content_items = aggregate state + the owner's
// manual-loop reading surface; content_events = the ContentGenerated v1 stream
// (only writer: Content Generation, D12). Payload per the approved contract:
// fat enough for the manual loop — full provenance + media refs.

import type { SourceEventRecord, PillarRow, DraftJson, Validation } from "./types.ts";

function headers(key: string, ret: "representation" | "minimal") {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: `return=${ret}`,
  };
}

function buildEvidence(ev: SourceEventRecord) {
  const p = ev.payload;
  return [{
    claim: [p.title, p.summary].filter(Boolean).join(" — ").slice(0, 300),
    url: p.url ?? null,
    source: p.source ?? null,
    published_at: p.published_at ?? null,
  }];
}

function buildMediaRefs(ev: SourceEventRecord) {
  const p = ev.payload;
  const refs: { url: string; source_url: string | null; kind: string }[] = [];
  if (p.image_url) refs.push({ url: String(p.image_url), source_url: (p.url as string) ?? null, kind: "image" });
  for (const m of (p.media as unknown[] | null) ?? []) {
    if (typeof m === "string") refs.push({ url: m, source_url: (p.url as string) ?? null, kind: "media" });
  }
  return refs;
}

export async function writeContentItem(
  base: string,
  key: string,
  x: {
    page: string; pillar: PillarRow; draft: Required<DraftJson>;
    event: SourceEventRecord;
    validation: Validation & { revised: boolean; flags: string[] };
  },
): Promise<number> {
  const res = await fetch(`${base}/rest/v1/content_items`, {
    method: "POST",
    headers: headers(key, "representation"),
    body: JSON.stringify({
      page_id: x.page,
      pillar_id: x.pillar.pillar_id,
      pillar_version: x.pillar.version,
      status: "draft",
      draft: {
        copy: x.draft.copy, title: x.draft.title ?? null,
        hashtags: x.draft.hashtags ?? [], language: x.draft.language,
      },
      format_hint: x.draft.format_hint ?? null,
      entities: (x.event.payload.entities as Record<string, unknown>) ?? {},
      evidence: buildEvidence(x.event),
      media_refs: buildMediaRefs(x.event),
      image_prompt: x.draft.image_prompt ?? null,
      angle_entity: x.draft.entity,
      movie_year: x.draft.movie_year ?? null,
      angle_hook: x.draft.hook ?? null,
      source_event_id: x.event.event_id,
      correlation_id: x.event.correlation_id,
      trend_signal_id: x.event.payload.trend_signal_id ?? null,  // RAZ-72: trace back to the trend
      validation: x.validation,
    }),
  });
  if (!res.ok) throw new Error(`write content_items ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json() as { id: number }[];
  return rows[0].id;
}

export async function writeContentEvent(
  base: string,
  key: string,
  x: {
    itemId: number; page: string; pillar: PillarRow; draft: Required<DraftJson>;
    event: SourceEventRecord; lang: string; region: string;
  },
): Promise<void> {
  const payload = {
    page: x.page,
    pillar_id: x.pillar.pillar_id,
    pillar_version: x.pillar.version,
    draft: {
      copy: x.draft.copy, title: x.draft.title ?? null,
      hashtags: x.draft.hashtags ?? [], language: x.draft.language,
    },
    format_hint: x.draft.format_hint ?? "text",
    entities: (x.event.payload.entities as Record<string, unknown>) ?? {},
    evidence: buildEvidence(x.event),
    media_refs: buildMediaRefs(x.event),
    image_prompt: x.draft.image_prompt ?? null,
    angle: { entity: x.draft.entity, pillar_id: x.pillar.pillar_id, hook: x.draft.hook ?? null },
    source_event_id: x.event.event_id,
    trend_signal_id: x.event.payload.trend_signal_id ?? null,   // RAZ-72: lineage to the trend
    lang: x.lang,
    region: x.region,
  };
  const res = await fetch(`${base}/rest/v1/content_events`, {
    method: "POST",
    headers: headers(key, "minimal"),
    body: JSON.stringify({
      event_type: "ContentGenerated",
      schema_version: 2,   // v2 (RAZ-72): payload adds `trend_signal_id` (additive; null off the trend path)
      aggregate_id: String(x.itemId),
      correlation_id: x.event.correlation_id,     // lineage from the source event
      causation_id: x.event.event_id,             // caused by the SourceEnriched
      payload,
    }),
  });
  if (!res.ok) throw new Error(`write content_events ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
