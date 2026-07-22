import catalogJson from "../sources.json" with { type: "json" };
import type { MaterialSource, MaterialSubscription, MaterialJob, RefRow, HarvestJob, SearchJob, ArticleRow } from "../service/types.ts";

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

// page_article_sources rows (RAZ-25), gated by page_source_settings like the material subs.
// Both modes run in-function: rss parses a feed, scrape pulls ONE page through the Web
// Unlocker (a direct fetch, seconds — not a discover job, so no n8n needed).
export async function loadArticleRows(supabaseUrl: string, serviceKey: string): Promise<ArticleRow[]> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const res = await fetch(
    `${supabaseUrl}/rest/v1/page_article_sources?enabled=eq.true&select=*`,
    { headers: h },
  );
  if (!res.ok) throw new Error(`Failed to load page_article_sources: ${res.status}`);
  const rows = (await res.json()) as ArticleRow[];

  const gate = await fetch(
    `${supabaseUrl}/rest/v1/page_source_settings?sources_enabled=eq.true&select=page_id`,
    { headers: h },
  );
  const on = new Set<string>(((await gate.json()) as { page_id: string }[]).map((r) => r.page_id));
  return rows.filter((r) => on.has(r.page_id));
}

// page_reference_sources rows for READ-ONLY plan scopes, gated by page_source_settings
// like the material subs. RAZ-43 (post-review): the DUE path does NOT come through here —
// due rows are claimed+advanced atomically by ref_harvest_claim() in SQL (see index.ts
// claimDueRefs). This loader serves:
//   "triggered" = rows with a trigger_rule (fired by a trend event; caller must narrow
//                 with pages — enforced in runHarvestPlan).
//   "all"       = no cadence filter; ref_ids = an on-demand pick.
export async function loadRefRows(
  supabaseUrl: string,
  serviceKey: string,
  opts: { scope?: "all" | "triggered"; ref_ids?: number[]; pages?: string[] },
): Promise<RefRow[]> {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  let q = `${supabaseUrl}/rest/v1/page_reference_sources?enabled=eq.true&select=*`;
  if (opts.scope === "triggered") q += `&trigger_rule=not.is.null`;
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
  // RAZ-43: present on trend-triggered plans — the trend's correlation lineage rides
  // job → worker → ingest so the emitted events trace to the TrendDetected, not a fresh id.
  trend: Record<string, unknown> | null = null,
): { jobs: HarvestJob[]; skipped: { ref_id: number; platform: string; reason: string }[] } {
  const jobs: HarvestJob[] = [];
  const skipped: { ref_id: number; platform: string; reason: string }[] = [];
  const trig = triggerFrom(trend);

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

    // RAZ-68: append BD push-delivery params (shadow until HARVEST_INGEST_SECRET is set).
    trigger_url += deliverySuffix({
      ingest_source: src.name,
      page_id: r.page_id,
      strategy: r.strategy,
      window_days: r.window_days,
      cap: r.cap,
      ref_kind: r.ref_kind,
      trigger: trig,
    });

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
      // n8n echoes these fields back so the selection needs no extra DB read.
      strategy_supported: r.strategy === "latest_n" || r.strategy === "best_performing",
      // RAZ-43: inspiration class + optional trend lineage, echoed back on ingest.
      // No fallback: the column is NOT NULL DEFAULT 'competitor' — re-encoding the
      // default here would hide drift if the DB default ever changes (review 2026-07-19).
      ref_kind: r.ref_kind,
      trigger: trig,
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

// RAZ-68: Bright Data push-delivery. When HARVEST_INGEST_SECRET is set, tell BD to
// POST the finished snapshot straight to m2-harvest-ingest (no n8n poll/download, no
// in-memory snapshot hold). BD's delivery POST is data-only, so the job echo the worker
// used to attach on ingest rides as query params ON the endpoint URL — the URL IS the
// context. Absent secret = no params appended, behaviour identical to before (fail-safe),
// so this stays fully shadow until the secret is deployed.
function deliverySuffix(job: {
  ingest_source: string;
  page_id?: string | null;
  strategy?: string | null;
  window_days?: number | null;
  cap?: number | null;
  ref_kind?: string | null;
  trigger?: { correlation_id: string; causation_id: string | null } | null;
}): string {
  const secret = Deno.env.get("HARVEST_INGEST_SECRET");
  const base = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!secret || !base || !anon) return "";
  // Delivery target is the m2-contentsource domain fn (ingest=harvest route). BD's
  // auth_header carries the public anon key so it passes verify_jwt at the gateway;
  // the shared secret `k` (checked in-code) is the real guard. Job echo rides along
  // so BD's data-only POST is self-describing.
  const echo = new URLSearchParams();
  echo.set("ingest", "harvest");
  echo.set("k", secret);
  echo.set("source", job.ingest_source);
  if (job.page_id) echo.set("page_id", job.page_id);
  if (job.strategy) echo.set("strategy", job.strategy);
  if (job.window_days != null) echo.set("window_days", String(job.window_days));
  if (job.cap != null) echo.set("cap", String(job.cap));
  if (job.ref_kind) echo.set("ref_kind", job.ref_kind);
  if (job.trigger) {
    echo.set("correlation_id", job.trigger.correlation_id);
    if (job.trigger.causation_id) echo.set("causation_id", job.trigger.causation_id);
  }
  const endpoint = `${base}/functions/v1/m2-contentsource?${echo.toString()}`;
  return `&endpoint=${encodeURIComponent(endpoint)}` +
    `&auth_header=${encodeURIComponent("Bearer " + anon)}` +
    `&uncompressed_webhook=true`;
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
    s.type === "brightdata" && s.bd_input === "keyword" &&
    (sourceNames ? sourceNames.includes(s.name) : false)
  );
  if (sourceNames) {
    for (const n of sourceNames) {
      if (!candidates.some((c) => c.name === n)) skipped.push({ source: n, reason: "not a bd keyword-search source" });
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

    // The search term goes under the platform's OWN field name (probe-confirmed: youtube
    // keyword_search · tiktok search_keyword · reddit/pinterest keyword). BD rejects unknown
    // fields outright, so this is data, never a guess.
    const kwField = src.bd_keyword_field ?? "keyword";
    const row: Record<string, unknown> = { [kwField]: keyword, ...(src.bd_params ?? {}) };
    // video_type is Bright Data's own enum (Video | Shorts; omit = both) and only exists on
    // sources that declare a field for it — otherwise it is dropped rather than injected
    // into a payload BD would reject.
    const t = String(opts.videoType ?? "").trim();
    if (t && src.bd_video_type_field) row[src.bd_video_type_field] = t;

    jobs.push({
      source: src.name,
      ingest_source: src.name,
      platform: src.platform ?? null,
      dataset_id: src.dataset_id,
      discover_by: src.bd_discover_by ?? null,
      trigger_url,
      inputs: [row],
      cap,
      keyword,
      sink: opts.sink ?? "manual",
      ai_assist: !!opts.aiAssist,
    });
  }
  return { jobs, skipped };
}

// RAZ-25 · one job per distinct feed URL, subscribers = every page wanting that feed.
// Deliberately NOT buildMaterialJobs: that fills {placeholders} through encodeURIComponent,
// which is right for a query param but would mangle a whole feed URL
// ("{feed_url}" -> "https%3A%2F%2Fvariety.com%2Ffeed%2F"). A feed URL is the endpoint itself,
// so it is assigned directly and never templated.
export function buildArticleJobs(
  catalog: MaterialSource[],
  rows: ArticleRow[],
  trend: Record<string, unknown> | null,
): MaterialJob[] {
  // The row's mode picks the adapter — one config table, two extractors.
  const byMode: Record<string, MaterialSource | undefined> = {
    rss: catalog.find((s) => s.name === "article_rss"),
    scrape: catalog.find((s) => s.name === "article_scrape"),
  };
  const trig = triggerFrom(trend);

  const byUrl = new Map<string, MaterialJob>();
  for (const r of rows) {
    const src = byMode[r.mode];
    if (!src || !src.enabled) continue;
    if (!/^https?:\/\//i.test(r.url ?? "")) continue; // a bad row must not become a fetch
    if (!byUrl.has(r.url)) {
      byUrl.set(r.url, { source: src, params: {}, url: r.url, subscribers: [], trigger: trig });
    }
    const job = byUrl.get(r.url)!;
    // Defence in depth: fanOut emits one event per (material x subscriber), so the SAME page
    // listed twice for one feed silently doubles every article into the stream. The unique
    // index on (page_id, url) is the real guard — this makes a missed constraint or a bad
    // backfill harmless instead of quietly corrupting the stream.
    if (job.subscribers.some((s) => s.page_id === r.page_id)) continue;
    job.subscribers.push({ page_id: r.page_id, source: job.source.name, params: {}, enabled: true });
  }
  return [...byUrl.values()];
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
