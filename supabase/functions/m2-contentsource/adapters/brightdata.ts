// Bright Data adapter (type="brightdata"). One config-driven adapter for ALL
// Bright Data scrapers — AI-search (ChatGPT/Perplexity/Gemini/Google AI/Copilot)
// and social (Facebook/IG/X/TikTok/YouTube/LinkedIn/Reddit/Pinterest/Quora).
//
// Calls the sync endpoint POST /datasets/v3/scrape?dataset_id=gd_xxx. When Bright
// Data can finish inside the sync window it returns the records array directly;
// when it can't it DEFERS to async and returns a snapshot reference instead — we
// then poll /progress and download /snapshot within our time budget. Everything
// stays inside one function call so the manual/trend search still gets a result.
//
// Each source in sources.json carries its own dataset_id + field_map, so adding a
// platform = one catalog entry, no code change. dataset_id lives in the Bright Data
// dashboard (/cp/datasets); until pasted the job errors defensively (logged, other
// sources still run).

import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { MaterialJob } from "../service/types.ts";

const BD_BASE = "https://api.brightdata.com/datasets/v3";
const TIMEOUT_MS = 110_000;  // total budget per source (stay under edge-function wall time)
const POLL_MS = 4_000;       // gap between snapshot progress checks
const MAX_INPUTS = 20;       // sync endpoint input limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

// bd_input="url": resolve the job's target pages to their reference URLs for this
// platform (page_reference_sources). Only enabled rows; capped to MAX_INPUTS.
async function resolveRefUrls(
  job: MaterialJob,
  platform: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string[]> {
  const pageIds = job.subscribers.map((s) => s.page_id).filter(Boolean);
  if (pageIds.length === 0) return [];
  const inList = pageIds.map((p) => `"${p}"`).join(",");
  const url =
    `${supabaseUrl}/rest/v1/page_reference_sources` +
    `?enabled=eq.true&platform=eq.${encodeURIComponent(platform)}` +
    `&page_id=in.(${encodeURIComponent(inList)})&select=ref_url`;
  const res = await fetch(url, { headers: { apikey: serviceKey, ...auth(serviceKey) } });
  if (!res.ok) throw new Error(`page_reference_sources ${res.status}`);
  const rows = (await res.json()) as { ref_url: string }[];
  return rows.map((r) => r.ref_url).filter(Boolean).slice(0, MAX_INPUTS);
}

// Build the Bright Data input rows for one job.
async function buildInputs(
  job: MaterialJob,
  keyword: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Record<string, unknown>[]> {
  const src = job.source;
  const extra = src.bd_params ?? {};

  if (src.bd_input === "url") {
    if (!src.platform) throw new Error(`${src.name}: bd_input=url needs a platform`);
    const urls = await resolveRefUrls(job, src.platform, supabaseUrl, serviceKey);
    // "collect by URL" scrapers take ONLY their declared inputs (url + bd_params like
    // num_of_posts) — do NOT inject keyword (unknown field errors the scrape). The page's
    // recent posts are the material; keyword relevance is applied after by AI-assist.
    return urls.map((u) => ({ url: u, ...extra }));
  }

  // bd_input="keyword": keyword DISCOVERY. One row, the keyword under the platform's own
  // field name — which differs per platform, hence config not code.
  if (src.bd_input === "keyword") {
    if (!keyword) return [];
    const kwField = src.bd_keyword_field ?? "keyword";
    const row: Record<string, unknown> = { [kwField]: keyword, ...extra };
    const t = String(job.params.video_type ?? "").trim();
    if (t && src.bd_video_type_field) row[src.bd_video_type_field] = t;
    return [row];
  }

  // bd_input="prompt" (default): AI-search scrapers — one row, the keyword as prompt.
  // Every AI scraper also declares `url` Required (the chat surface it drives, e.g.
  // https://www.perplexity.ai) — omitting it fails the scrape, so bd_url is mandatory.
  if (!keyword) return [];
  if (!src.bd_url) throw new Error(`${src.name}: bd_input=prompt needs bd_url`);
  return [{ url: src.bd_url, prompt: keyword, ...extra }];
}

// Bright Data KEEPS COLLECTING (and billing) server-side after we stop polling, so
// abandoning a snapshot is not free — giving up REQUIRES an explicit cancel. The n8n
// Harvest Worker has always done this (Cancel Snapshot node); this path did not, and a
// sync-window timeout on 2026-07-17 left sd_mroih9qhfbng0pqr4 running. Best-effort: never
// let a cancel failure mask the original error.
async function cancelSnapshot(id: string, key: string): Promise<void> {
  try {
    await guardedFetch(`${BD_BASE}/snapshot/${id}/cancel`, { method: "POST", headers: auth(key) });
  } catch { /* ignore — the caller is already throwing */ }
}

// Async fallback: poll a snapshot to completion, then download its records.
async function pollSnapshot(id: string, key: string, deadline: number): Promise<unknown[]> {
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const { res: p } = await guardedFetch(`${BD_BASE}/progress/${id}`, { headers: auth(key) });
    const status = ((await p.json()) as { status?: string })?.status;
    if (status === "ready") {
      const { res: s, done } = await guardedFetch(`${BD_BASE}/snapshot/${id}?format=json`, { headers: auth(key) });
      if (!s.ok) throw new Error(`snapshot ${id} download ${s.status}`);
      const data = await s.json();
      const items = Array.isArray(data) ? data : data ? [data] : [];
      await done(items.length);
      return items;
    }
    if (status === "failed") throw new Error(`Bright Data snapshot ${id} failed`);
  }
  // Out of budget: cancel before throwing, or it collects on our dime unobserved.
  await cancelSnapshot(id, key);
  throw new Error(
    `Bright Data scrape exceeded the sync window (snapshot ${id} cancelled; move this source to async harvest)`,
  );
}

export async function pullBrightData(
  job: MaterialJob,
  brightKey: string | undefined,
  supabaseUrl: string,
  serviceKey: string,
): Promise<unknown[]> {
  const src = job.source;
  if (!brightKey) throw new Error("BRIGHTDATA_API_KEY not set");
  if (!src.dataset_id || src.dataset_id.startsWith("gd_REPLACE")) {
    throw new Error(`${src.name}: dataset_id not set — paste it from the Bright Data dashboard`);
  }
  // DISCOVER jobs are async-only. Bright Data's own guidance: discovery tasks must run via
  // POST /datasets/v3/trigger and can take several minutes; sync /scrape has a ~1min budget.
  // Measured 2026-07-17: bd_input=url channel discover ~4min; bd_input=keyword discover
  // 112.6s with dataset_size STILL 0 (nothing collected). Both belong on the async
  // n8n path (search_plan/harvest_plan → trigger → poll → download → ingest).
  // Only bd_input=prompt (AI-search: one prompt → one answer, 19–78s proven) runs here.
  if (src.bd_input === "url" || src.bd_input === "keyword") {
    throw new Error(
      `${src.name}: ${src.bd_input} is a DISCOVER job and is async-only — use the n8n ` +
        `${src.bd_input === "url" ? "harvest_plan" : "search_plan"}→worker→ingest path, not sync search`,
    );
  }

  const keyword = String(job.params.query ?? "").trim();
  const inputs = await buildInputs(job, keyword, supabaseUrl, serviceKey);
  if (inputs.length === 0) return []; // nothing to scrape (e.g. no ref pages for this platform)

  const deadline = Date.now() + TIMEOUT_MS;

  // /scrape accepts discover params (probe-confirmed 2026-07-17: it echoes the discover
  // input schema rather than rejecting the endpoint). A discover job MUST be capped —
  // uncapped it crawls open-endedly and bills per record — and search_filters declares no
  // num_of_posts, so limit_per_input is the only cap that exists.
  let scrapeUrl = `${BD_BASE}/scrape?dataset_id=${encodeURIComponent(src.dataset_id)}` +
    `&format=json&notify=false&include_errors=true`;
  let estimatedRecords = inputs.length;               // prompt scrapers: one answer per row
  if (src.bd_discover_by) {
    const cap = src.bd_search_cap ?? 10;
    scrapeUrl += `&type=discover_new&discover_by=${encodeURIComponent(src.bd_discover_by)}` +
      `&limit_per_input=${cap}`;
    estimatedRecords = inputs.length * cap;           // discover: up to cap records PER input
  }

  // Body envelope is {"input":[...]} — the bare array the /trigger endpoint takes is
  // NOT what /scrape expects (confirmed against every scraper's own code example).
  // estimatedRecords is charged up-front on the record budget and reconciled by done()
  // with the actual count.
  const { res, done } = await guardedFetch(
    scrapeUrl,
    {
      method: "POST",
      headers: { ...auth(brightKey), "Content-Type": "application/json" },
      body: JSON.stringify({ input: inputs }),
    },
    { estimatedRecords },
  );
  if (!res.ok) throw new Error(`Bright Data ${src.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  if (Array.isArray(data)) {                               // sync: records returned directly
    await done(data.length);
    return data;
  }
  const snapshotId = (data as { snapshot_id?: string; id?: string })?.snapshot_id ??
    (data as { id?: string })?.id;
  if (snapshotId) return await pollSnapshot(snapshotId, brightKey, deadline); // deferred to async
  return data ? [data] : [];
}
