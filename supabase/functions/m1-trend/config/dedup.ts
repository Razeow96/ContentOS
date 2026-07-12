// Freshness/dedup invariant (RAZ-14). A raw trend is unique per
// (source, topic, region, country, language, timeframe, window).
// Backed by the `trends` state table. Returns only trends not seen in-window.
 
import type { RawTrend } from "../service/types.ts";
 
export async function filterFresh(
  trends: RawTrend[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<RawTrend[]> {
  const fresh: RawTrend[] = [];
  for (const t of trends) {
    // natural key for the window
    const key = [t.source, t.topic, t.region, t.country, t.language, t.timeframe]
      .map((x) => x ?? "").join("|");
 
    // insert-if-absent using ON CONFLICT DO NOTHING via PostgREST upsert
    const res = await fetch(`${supabaseUrl}/rest/v1/trends`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        dedup_key: key,
        source: t.source,
        topic: t.topic,
        region: t.region,
        country: t.country,
        language: t.language,
        timeframe: t.timeframe,
        raw_trend_id: t.raw_trend_id,
      }),
    });
    const rows = res.ok ? await res.json() : [];
    // representation returns the row only when newly inserted (fresh)
    if (Array.isArray(rows) && rows.length > 0) fresh.push(t);
  }
  return fresh;
}