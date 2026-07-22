/*
 * normalize.ts
 * Turns raw platform items into RawTrend records, then fans out to
 * TrendDetected events (one per subscribing page). Applies the source field_map.
 */
import { mapField } from "../config/fieldmap.ts";
import type { PullJob, RawTrend, TrendDetected } from "./types.ts";

function s(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v);
}

export function normalize(job: PullJob, items: unknown[]): RawTrend[] {
  const fm = job.source.field_map ?? {};
  const out: RawTrend[] = [];
  let rank = 0;
  for (const it of items) {
    rank++;
    const topic = mapField(it, fm.topic);
    if (topic === undefined || topic === null || String(topic).trim() === "") continue;

    const volume = fm.volume_value
      ? { value: mapField(it, fm.volume_value) ?? null, unit: s(mapField(it, fm.volume_unit)), source: job.source.name }
      : null;

    out.push({
      raw_trend_id: crypto.randomUUID(),
      source: job.source.name,
      adapter_type: job.source.type,
      timeframe: job.source.timeframe,
      topic: String(topic),
      description: s(mapField(it, fm.description)),
      category: s(mapField(it, fm.category)),
      keywords: (mapField(it, fm.keywords) as string[] | null) ?? null,
      volume,
      rank: fm.rank ? (mapField(it, fm.rank) as number | null) ?? rank : rank,
      signal_type: job.source.signal_type,
      image_url: s(mapField(it, fm.image_url)),
      related: mapField(it, fm.related) ?? null,
      external_id: s(mapField(it, fm.external_id)),
      url: s(mapField(it, fm.url)),
      region: job.region,
      country: job.country,
      language: job.language,
      detected_at: s(mapField(it, fm.detected_at)) ?? new Date().toISOString(),
      raw: it,
    });
  }
  return out;
}

// trendSignalId is minted ONCE per campaign run (in run()) and stamped on every
// event of the run — so all trends from one campaign share one trend_signal_id,
// while each trend×page keeps its own per-flow correlation_id (RAZ-72).
export function fanOut(job: PullJob, trends: RawTrend[], trendSignalId: string): TrendDetected[] {
  const events: TrendDetected[] = [];
  for (const t of trends) {
    for (const sub of job.subscribers) {
      events.push({
        ...t,
        page: sub.page_id,
        campaign: sub.campaign ?? null,
        event_type: "TrendDetected",
        correlation_id: crypto.randomUUID(),
        trend_signal_id: trendSignalId,
      });
    }
  }
  return events;
}