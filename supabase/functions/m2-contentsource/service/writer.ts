// Writes SourceEnriched events into the source_events stream (the domain owns this).
// The INSERT fires the Supabase webhook, fanning out to downstream domains (M3+).

import type { SourceEnriched, RawMaterial } from "./types.ts";

export async function writeSourceEvents(
  events: SourceEnriched[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    event_type: "SourceEnriched",
    schema_version: 3,   // v2 (RAZ-72): + `trend_signal_id` · v3 (RAZ-73): + compiled trend fields
                         // `keywords`/`sources_manual`/`sources_auto`/per-item `freshness` (all additive/optional)
    aggregate_id: e.raw_material_id,
    correlation_id: e.correlation_id,
    causation_id: e.causation_id,
    payload: e,          // fat, self-contained (ADR-001 A3)
  }));

  const res = await fetch(`${supabaseUrl}/rest/v1/source_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Write source_events failed: ${res.status} ${await res.text()}`);
  return rows.length;
}

// Writes manual keyword-search results into manual_search_results (RAZ-37).
// ISOLATED store — status='new' until a human promotes it. Never source_events.
export async function writeManualResults(
  keyword: string,
  aiAssisted: boolean,
  materials: RawMaterial[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<number> {
  if (materials.length === 0) return 0;

  const rows = materials.map((m) => ({
    keyword,
    source: m.source,
    material_type: m.material_type,
    external_id: m.external_id,
    ai_assisted: aiAssisted,
    status: "new",
    payload: m,
  }));

  const res = await fetch(`${supabaseUrl}/rest/v1/manual_search_results`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Write manual_search_results failed: ${res.status} ${await res.text()}`);
  return rows.length;
}
