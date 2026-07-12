// Loads the two config sources: trendsource.json (from GitHub raw or bundled)
// and page_trend_sources (from SQL). Builds the list of pull jobs.
 
import type { Source, Subscription, PullJob } from "../service/types.ts";
 
const SOURCES_URL = Deno.env.get("TRENDSOURCE_URL") ??
  "https://raw.githubusercontent.com/Razeow96/ContentOS/main/trend/trendsource.json";
 
export async function loadSources(): Promise<Source[]> {
  const res = await fetch(SOURCES_URL);
  if (!res.ok) throw new Error(`Failed to fetch trendsource.json: ${res.status}`);
  const json = await res.json();
  const arr = Array.isArray(json.sources) ? json.sources : [];
  return arr.filter((s: Source) => s && s.enabled && s.name);
}
 
// Reads enabled subscriptions for enabled pages via the Supabase REST endpoint.
export async function loadSubscriptions(supabaseUrl: string, serviceKey: string): Promise<Subscription[]> {
  // page_trend_settings gate: only pages with trends_enabled = true
  const url = `${supabaseUrl}/rest/v1/page_trend_sources?enabled=eq.true&select=*`;
  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`Failed to load subscriptions: ${res.status}`);
  const rows = (await res.json()) as Subscription[];
 
  // filter to pages that are switched on
  const gate = await fetch(
    `${supabaseUrl}/rest/v1/page_trend_settings?trends_enabled=eq.true&select=page_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  const on = new Set<string>(((await gate.json()) as { page_id: string }[]).map((r) => r.page_id));
  return rows.filter((r) => on.has(r.page_id));
}
 
function pick<T>(v: T | null | undefined, d: T | null): T | null {
  return v === null || v === undefined || v === "" ? d : v;
}
 
export function buildPullJobs(sources: Source[], subs: Subscription[]): PullJob[] {
  const byName: Record<string, Source> = {};
  for (const s of sources) byName[s.name] = s;
 
  const jobs: Record<string, PullJob> = {};
  for (const sub of subs) {
    const src = byName[sub.source_name];
    if (!src) continue;
    const d = src.defaults ?? {};
    const region = pick(sub.region, d.region ?? null);
    const language = pick(sub.language, d.language ?? null);
    const country = pick(sub.country, d.country ?? null);
    const chart = pick(sub.chart, (d.chart as string) ?? null);
    const max = pick(sub.max_results ? String(sub.max_results) : null, (d.max as string) ?? null);
 
    const key = [sub.source_name, region, language, chart, max].join("|");
    if (!jobs[key]) {
      let url = String(src.url ?? "")
        .replaceAll("{region}", region ?? "")
        .replaceAll("{language}", language ?? "")
        .replaceAll("{country}", country ?? "")
        .replaceAll("{chart}", chart ?? "")
        .replaceAll("{max}", max ?? "");
      // {auth} is applied by the adapter from the secret env var, so strip it here.
      url = url.replace(/[?&]key=\{auth\}/g, "").replace(/\{auth\}/g, "");
      jobs[key] = { source: src, region, language, country, chart, max, url, subscribers: [] };
    }
    jobs[key].subscribers.push(sub);
  }
  return Object.values(jobs);
}