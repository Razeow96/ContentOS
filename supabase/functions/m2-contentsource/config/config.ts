import catalogJson from "../sources.json" with { type: "json" };
import type { MaterialSource, MaterialSubscription, MaterialJob, RefRow, HarvestJob, SearchJob } from "../service/types.ts";

const BD_BASE = "https://api.brightdata.com/datasets/v3";

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

// page_reference_sources rows to harvest, gated by page_source_settings like the
// material subs. scope="daily" = the nightly schedule; ref_ids = an on-demand pick.
export async function loadRefRows(
  supabaseUrl: string,
  serviceKey: string,
  opts: { scope?: "daily" | "all"; ref_ids?: number[]; pages?: string[] },
): Promise<RefRow[]> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  let q = `${supabaseUrl}/rest/v1/page_reference_sources?enabled=eq.true&select=*`;
  if (opts.scope === "daily") q += `&harvest_schedule=eq.daily`;
  if (opts.ref_ids?.length) q += `&id=in.(${opts.ref_ids.join(",")})`;
  if (opts.pages?.length) q += `&page_id=in.(${opts.pages.map((p) => `"${p}"`).join(",")})`;

  const res = await fetch(q, { headers: h });
  if (!res.ok) throw new Error(`Failed to load page_reference_sources: ${res.status}`);
  const rows = (await res.json()) as RefRow[];

  const gate = await fetch(
    `${supabaseUrl}/rest/v1/page_source_settings?sources_enabled=eq.true&select=page_id`,
    { headers: h },
  );
  const on = new Set<string>(((await gate.json()) as { page_id: string }[]).map((r) => r.page_id));
  return rows.filter((r) => on.has(r.page_id));
}

// Join ref rows against the Bright Data catalog -> ready-to-execute jobs.
// This is the whole point of harvest_plan: dataset_id/discover_by/inputs are
// resolved HERE so n8n never holds config and never joins anything.
export function buildHarvestPlan(
  catalog: MaterialSource[],
  refs: RefRow[],
): { jobs: HarvestJob[]; skipped: { ref_id: number; platform: string; reason: string }[] } {
  const jobs: HarvestJob[] = [];
  const skipped: { ref_id: number; platform: string; reason: string }[] = [];

  for (const r of refs) {
    const src = catalog.find(
      (s) => s.type === "brightdata" && s.bd_input === "url" && s.platform === r.platform,
    );
    if (!src) { skipped.push({ ref_id: r.id, platform: r.platform, reason: "no catalog source for platform" }); continue; }
    if (!src.enabled) { skipped.push({ ref_id: r.id, platform: r.platform, reason: `${src.name} disabled` }); continue; }
    if (!src.dataset_id || src.dataset_id.startsWith("gd_REPLACE")) {
      skipped.push({ ref_id: r.id, platform: r.platform, reason: `${src.name} dataset_id not set` });
      continue;
    }
    if (!/^https?:\/\//i.test(r.ref_url ?? "")) {
      skipped.push({ ref_id: r.id, platform: r.platform, reason: `ref_url is not a URL: ${r.ref_url}` });
      continue;
    }

    // Async trigger endpoint. discover_by present = seed a profile and let Bright Data
    // FIND the posts; absent = collect-by-URL (Facebook's profile->posts scraper).
    let trigger_url = `${BD_BASE}/trigger?dataset_id=${encodeURIComponent(src.dataset_id)}&format=json&notify=false&include_errors=true`;
    if (src.bd_discover_by) trigger_url += `&type=discover_new&discover_by=${encodeURIComponent(src.bd_discover_by)}`;
    // Cap the DISCOVER phase itself. Without this BD crawls the whole profile
    // open-endedly — reddit/youtube ran >10min and looked "slow" when the job was
    // just unbounded (caught 2026-07-16).
    if (r.cap && r.cap > 0) trigger_url += `&limit_per_input=${r.cap}`;

    // Merge the row's cap into the scraper's post-count input when it declares one.
    const extra: Record<string, unknown> = { ...(src.bd_params ?? {}) };
    if (r.cap && "num_of_posts" in extra) extra.num_of_posts = r.cap;

    // Derive the sort from the REF's strategy. Sorting "New" while ranking by
    // best_performing would rank brand-new posts that have no engagement yet — the
    // ordering has to agree with what the strategy selects on. Both the param name and
    // its values come from the catalog (see bd_sort_param/bd_sort_by_strategy), so this
    // stays config-driven and no platform enum lives here.
    if (src.bd_sort_param && src.bd_sort_by_strategy) {
      const sortValue = src.bd_sort_by_strategy[r.strategy];
      if (sortValue) {
        extra[src.bd_sort_param] = sortValue;
      } else {
        // Unknown strategy = we do not know how to order it. Skip rather than silently
        // scrape under the wrong sort and rank on it.
        skipped.push({
          ref_id: r.id,
          platform: r.platform,
          reason: `${src.name}: no sort mapped for strategy "${r.strategy}"`,
        });
        continue;
      }
    }

    jobs.push({
      ref_id: r.id,
      page_id: r.page_id,
      platform: r.platform,
      source: src.name,
      // Ingest under the PLATFORM entry, not the generic reference_harvest one.
      // Its field_map is the platform-verified one (e.g. bd_facebook maps composite
      // engagement likes/num_comments/num_shares), whereas reference_harvest maps
      // engagement to a bare "engagement" path and so assumes n8n pre-shaped it —
      // which would mean per-platform knowledge in the orchestrator, and silently
      // yields engagement=null (best_performing then ranks everything as 0).
      ingest_source: src.name,
      dataset_id: src.dataset_id,
      discover_by: src.bd_discover_by ?? null,
      trigger_url,
      inputs: [{ url: r.ref_url, ...extra }],
      strategy: r.strategy,
      window_days: r.window_days,
      cap: r.cap,
      // Both strategies are applied on the ingest path (normalize.ts applyStrategy).
      // n8n echoes these three fields back so the selection needs no extra DB read.
      strategy_supported: r.strategy === "latest_n" || r.strategy === "best_performing",
    });
  }
  return { jobs, skipped };
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
// Keyword-DISCOVERY plan (async twin of buildHarvestPlan). Bright Data discovery tasks must
// go through POST /datasets/v3/trigger and can take minutes — sync /scrape times out with
// nothing collected (measured 112.6s, dataset_size 0). So M2 resolves the job here and n8n
// runs the slow trigger→poll→download→ingest loop, holding no config of its own (ADR-001).
export function buildSearchPlan(
  catalog: MaterialSource[],
  keyword: string,
  sourceNames: string[] | undefined,
  opts: { videoType?: string | null; cap?: number | null; sink?: "events" | "manual"; aiAssist?: boolean },
): { jobs: SearchJob[]; skipped: { source: string; reason: string }[] } {
  const jobs: SearchJob[] = [];
  const skipped: { source: string; reason: string }[] = [];

  // Bright Data is paid + slow: OPT-IN only, exactly as buildSearchJobs treats it.
  const candidates = catalog.filter((s) =>
    s.type === "brightdata" && s.bd_input === "search_filters" &&
    (sourceNames ? sourceNames.includes(s.name) : false)
  );
  if (sourceNames) {
    for (const n of sourceNames) {
      if (!candidates.some((c) => c.name === n)) skipped.push({ source: n, reason: "not a bd search_filters source" });
    }
  }

  for (const src of candidates) {
    if (!src.enabled) { skipped.push({ source: src.name, reason: `${src.name} disabled` }); continue; }
    if (!src.dataset_id || src.dataset_id.startsWith("gd_REPLACE")) {
      skipped.push({ source: src.name, reason: `${src.name} dataset_id not set` });
      continue;
    }
    // The ONLY cap: search_filters declares no num_of_posts, so without limit_per_input the
    // discover crawls open-endedly and bills per record.
    const cap = opts.cap && opts.cap > 0 ? opts.cap : (src.bd_search_cap ?? 10);

    let trigger_url = `${BD_BASE}/trigger?dataset_id=${encodeURIComponent(src.dataset_id)}` +
      `&format=json&notify=false&include_errors=true`;
    if (src.bd_discover_by) trigger_url += `&type=discover_new&discover_by=${encodeURIComponent(src.bd_discover_by)}`;
    trigger_url += `&limit_per_input=${cap}`;

    // video_type is Bright Data's own `type` enum (Video | Shorts); omit = both.
    const t = String(opts.videoType ?? "").trim();
    jobs.push({
      source: src.name,
      ingest_source: src.name,
      platform: src.platform ?? null,
      dataset_id: src.dataset_id,
      discover_by: src.bd_discover_by ?? null,
      trigger_url,
      inputs: [{ keyword_search: keyword, ...(t ? { type: t } : {}), ...(src.bd_params ?? {}) }],
      cap,
      keyword,
      sink: opts.sink ?? "manual",
      ai_assist: !!opts.aiAssist,
    });
  }
  return { jobs, skipped };
}

export function buildSearchJobs(
  catalog: MaterialSource[],
  keyword: string,
  sourceNames: string[] | undefined,
  pages: string[],
  trend: Record<string, unknown> | null,
  videoType?: string | null,
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
      // video_type is the caller's per-search video/shorts toggle (Bright Data's own enum:
      // Video | Shorts; omit = both). Only bd_input=search_filters reads it.
      const params = { ...(src.defaults ?? {}), query: keyword, video_type: videoType ?? null };
      return { source: src, params, url: fillUrl(src.url, params), subscribers, trigger: trig };
    });
}
