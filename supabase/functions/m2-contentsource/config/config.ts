import catalogJson from "../sources.json" with { type: "json" };
import type { MaterialSource, MaterialSubscription, MaterialJob } from "../service/types.ts";

// sources.json (the material catalog) sits beside index.ts and is bundled via the
// import above. Edit that file + redeploy to change/add API & RSS sources.
export function loadCatalog(): MaterialSource[] {
  const arr = Array.isArray((catalogJson as { sources?: MaterialSource[] }).sources)
    ? (catalogJson as { sources: MaterialSource[] }).sources
    : [];
  return arr.filter((s: MaterialSource) => s && s.name);
}

// page_material_sources rows, gated by page_source_settings.sources_enabled.
export async function loadMaterialSubs(supabaseUrl: string, serviceKey: string): Promise<MaterialSubscription[]> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const res = await fetch(`${supabaseUrl}/rest/v1/page_material_sources?enabled=eq.true&select=*`, { headers: h });
  if (!res.ok) throw new Error(`Failed to load page_material_sources: ${res.status}`);
  const rows = (await res.json()) as MaterialSubscription[];

  const gate = await fetch(
    `${supabaseUrl}/rest/v1/page_source_settings?sources_enabled=eq.true&select=page_id`,
    { headers: h },
  );
  const on = new Set<string>(((await gate.json()) as { page_id: string }[]).map((r) => r.page_id));
  return rows.filter((r) => on.has(r.page_id));
}

function fillUrl(tpl: string, params: Record<string, string | null>): string {
  let url = String(tpl ?? "");
  for (const [k, v] of Object.entries(params)) url = url.replaceAll(`{${k}}`, encodeURIComponent(v ?? ""));
  return url.replace(/[?&]\w+=\{auth\}/g, "").replace(/\{auth\}/g, "");
}

function triggerFrom(trend: Record<string, unknown> | null) {
  if (!trend) return null;
  return {
    correlation_id: (trend.correlation_id as string) ?? crypto.randomUUID(),
    causation_id: (trend.event_id as string) ?? (trend.causation_id as string) ?? null,
  };
}

// Build one job per (source + param-set). ingest-type sources never run here —
// they are handed in by n8n via the ingest path.
export function buildMaterialJobs(
  catalog: MaterialSource[],
  subs: MaterialSubscription[],
  trend: Record<string, unknown> | null,
): MaterialJob[] {
  const byName: Record<string, MaterialSource> = {};
  for (const s of catalog) byName[s.name] = s;

  const trig = triggerFrom(trend);
  const jobs: Record<string, MaterialJob> = {};
  for (const sub of subs) {
    const src = byName[sub.source];
    if (!src || !src.enabled || src.type === "ingest") continue;
    const params = { ...(src.defaults ?? {}), ...(sub.params ?? {}) };
    const url = fillUrl(src.url, params);
    const key = sub.source + "|" + JSON.stringify(params);
    if (!jobs[key]) jobs[key] = { source: src, params, url, subscribers: [], trigger: trig };
    jobs[key].subscribers.push(sub);
  }
  return Object.values(jobs);
}

// Ingest: n8n hands in already-fetched raw items for one source + the target pages
// (used by the Bright Data reference harvest and scrape-mode articles).
export function ingestJob(
  catalog: MaterialSource[],
  body: { source?: string; pages?: string[]; trigger?: { correlation_id: string; causation_id: string | null } | null },
): MaterialJob {
  const src = catalog.find((s) => s.name === body.source);
  if (!src) throw new Error(`Unknown ingest source: ${body.source}`);
  const subscribers: MaterialSubscription[] = (body.pages ?? []).map((p) => ({
    page_id: p, source: src.name, params: {}, enabled: true,
  }));
  return { source: src, params: {}, url: "", subscribers, trigger: body.trigger ?? null };
}

// Keyword search: one job per enabled search source, {query} = keyword (URL-encoded).
// Used by autonomous trend enrichment (sink=events) AND the manual tool (sink=manual).
export function buildSearchJobs(
  catalog: MaterialSource[],
  keyword: string,
  sourceNames: string[] | undefined,
  pages: string[],
  trend: Record<string, unknown> | null,
): MaterialJob[] {
  const trig = triggerFrom(trend);
  const subscribers: MaterialSubscription[] = pages.map((p) => ({ page_id: p, source: "", params: {}, enabled: true }));
  return catalog
    .filter((s) => {
      if (!s.enabled || s.search !== true || s.type === "ingest") return false;
      if (sourceNames) return sourceNames.includes(s.name);
      // Default (no sources filter) = cheap/free in-function sources only.
      // Bright Data (paid, slow) is OPT-IN — must be named in body.sources.
      return s.type !== "brightdata";
    })
    .map((src) => {
      const params = { ...(src.defaults ?? {}), query: keyword };
      return { source: src, params, url: fillUrl(src.url, params), subscribers, trigger: trig };
    });
}
