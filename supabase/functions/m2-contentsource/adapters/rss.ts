// RSS adapter. Fetches an RSS/XML feed and returns its <item> array.
// Config-only for any feed by changing url + field_map in the article source row.

import { parse } from "https://deno.land/x/xml@2.1.3/mod.ts";
import { getPath } from "../config/fieldmap.ts";
import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { MaterialJob } from "../service/types.ts";

export async function pullRss(job: MaterialJob): Promise<unknown[]> {
  const { res, done } = await guardedFetch(job.url, { headers: { "User-Agent": "content-os-m2/1.0" } }, { estimatedRecords: 30 });
  if (!res.ok) throw new Error(`RSS ${job.source.name} ${res.status}`);
  const xml = await res.text();
  const doc = parse(xml) as unknown;

  const path = job.source.response_items_path || "rss.channel.item";
  let items = getPath(doc, path);
  if (!Array.isArray(items)) items = items ? [items] : [];
  await done((items as unknown[]).length);
  return items as unknown[];
}
