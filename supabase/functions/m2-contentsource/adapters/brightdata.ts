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

  // bd_input="prompt" (default): AI-search scrapers — one row, the keyword as prompt.
  if (!keyword) return [];
  return [{ prompt: keyword, ...extra }];
}

// Async fallback: poll a snapshot to completion, then download its records.
async function pollSnapshot(id: string, key: string, deadline: number): Promise<unknown[]> {
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const p = await fetch(`${BD_BASE}/progress/${id}`, { headers: auth(key) });
    const status = ((await p.json()) as { status?: string })?.status;
    if (status === "ready") {
      const s = await fetch(`${BD_BASE}/snapshot/${id}?format=json`, { headers: auth(key) });
      if (!s.ok) throw new Error(`snapshot ${id} download ${s.status}`);
      const data = await s.json();
      return Array.isArray(data) ? data : data ? [data] : [];
    }
    if (status === "failed") throw new Error(`Bright Data snapshot ${id} failed`);
  }
  throw new Error("Bright Data scrape exceeded the sync window (move this source to async harvest)");
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
  // Social scrapers (bd_input=url) reliably run past the sync window (proven: FB > 110s).
  // They belong on the async harvest path (n8n trigger→snapshot→ingest), not sync search.
  // AI-search scrapers (bd_input=prompt) return a single answer fast and DO run here.
  if (src.bd_input === "url") {
    throw new Error(`${src.name}: social scraping is async-only — use the n8n harvest→ingest path, not sync search`);
  }

  const keyword = String(job.params.query ?? "").trim();
  const inputs = await buildInputs(job, keyword, supabaseUrl, serviceKey);
  if (inputs.length === 0) return []; // nothing to scrape (e.g. no ref pages for this platform)

  const deadline = Date.now() + TIMEOUT_MS;
  const res = await fetch(`${BD_BASE}/scrape?dataset_id=${encodeURIComponent(src.dataset_id)}&format=json`, {
    method: "POST",
    headers: { ...auth(brightKey), "Content-Type": "application/json" },
    body: JSON.stringify(inputs),
  });
  if (!res.ok) throw new Error(`Bright Data ${src.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  if (Array.isArray(data)) return data;                    // sync: records returned directly
  const snapshotId = (data as { snapshot_id?: string; id?: string })?.snapshot_id ??
    (data as { id?: string })?.id;
  if (snapshotId) return await pollSnapshot(snapshotId, brightKey, deadline); // deferred to async
  return data ? [data] : [];
}
