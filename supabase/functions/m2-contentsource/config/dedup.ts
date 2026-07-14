// Freshness/dedup invariant. A raw material is unique per (source, external_id, window_day),
// backed by the `source_material` state table. Returns only material not seen in-window.

import type { RawMaterial } from "../service/types.ts";

export async function filterFresh(
  materials: RawMaterial[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<RawMaterial[]> {
  const fresh: RawMaterial[] = [];
  for (const m of materials) {
    const dkey = [m.source, m.external_id].map((x) => x ?? "").join("|");

    // insert-if-absent; representation returns the row only when newly inserted (fresh).
    // window_day defaults to current_date in the table, so the unique key is
    // (dedup_key, window_day) per the SourceEnriched contract.
    const res = await fetch(`${supabaseUrl}/rest/v1/source_material`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        dedup_key: dkey,
        source: m.source,
        material_type: m.material_type,
        external_id: m.external_id,
        raw_material_id: m.raw_material_id,
      }),
    });
    const rows = res.ok ? await res.json() : [];
    if (Array.isArray(rows) && rows.length > 0) fresh.push(m);
  }
  return fresh;
}
