// Scrape skeleton. The ONLY adapter that may need per-source code.
// Default behavior: fetch the url and treat the JSON response as the item source
// (many "scrape" targets are actually undocumented JSON endpoints, e.g. Dcard).
// For true HTML scraping, add cheerio/DOM parsing here per source.
 
import { getPath } from "../config/fieldmap.ts";
import type { PullJob } from "../service/types.ts";
 
export async function pullScrape(job: PullJob): Promise<unknown[]> {
  const res = await fetch(job.url, { headers: { "User-Agent": "content-os-trend/1.0" } });
  if (!res.ok) throw new Error(`Scrape ${job.source.name} ${res.status}`);
 
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const json = await res.json();
    const path = job.source.response_items_path || "";
    let items = path ? getPath(json, path) : json;
    if (!Array.isArray(items)) items = items ? [items] : [];
    return items as unknown[];
  }
 
  // HTML branch: per-source extraction goes here. Returns [] until implemented.
  // const html = await res.text();
  // ... parse with a DOM lib, map to item objects ...
  return [];
}