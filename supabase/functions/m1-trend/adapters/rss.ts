// RSS skeleton. Fetches an RSS/XML feed and returns its items as plain objects.
// Config-only: works for any RSS source by changing url + field_map in trendsource.json.
 
import { parse } from "https://deno.land/x/xml@2.1.3/mod.ts";
import { getPath } from "../config/fieldmap.ts";
import type { PullJob } from "../service/types.ts";
 
export async function pullRss(job: PullJob): Promise<unknown[]> {
  const res = await fetch(job.url, { headers: { "User-Agent": "content-os-trend/1.0" } });
  if (!res.ok) throw new Error(`RSS ${job.source.name} ${res.status}`);
  const xml = await res.text();
  const doc = parse(xml) as unknown;
 
  const path = job.source.response_items_path || "rss.channel.item";
  let items = getPath(doc, path);
  if (!Array.isArray(items)) items = items ? [items] : [];
  return items as unknown[];
}