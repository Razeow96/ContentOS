// Writes TrendDetected events into the trend_events stream (the domain owns this).
// The INSERT fires the M0 Supabase webhook, fanning out to downstream domains.
 
import type { TrendDetected } from "./types.ts";
 
export async function writeTrendEvents(
  events: TrendDetected[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<number> {
  if (events.length === 0) return 0;
 
  const rows = events.map((e) => ({
    event_type: "TrendDetected",
    schema_version: 1,
    aggregate_id: e.raw_trend_id,
    correlation_id: e.correlation_id,
    causation_id: null,
    payload: e,          // fat, self-contained (ADR-001)
  }));
 
  const res = await fetch(`${supabaseUrl}/rest/v1/trend_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Write trend_events failed: ${res.status} ${await res.text()}`);
  return rows.length;
}