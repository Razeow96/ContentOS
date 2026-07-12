// API skeleton. Fetches a JSON REST endpoint. If the source needs a key,
// its auth_ref names a secret env var; we append it as ?key=... (query auth).
// Config-only for any JSON API by changing url + field_map + response_items_path.
 
import { getPath } from "../config/fieldmap.ts";
import type { PullJob } from "../service/types.ts";
 
export async function pullApi(job: PullJob): Promise<unknown[]> {
  let url = job.url;
  const authRef = job.source.auth_ref;
  if (authRef) {
    const key = Deno.env.get(authRef.replaceAll(" ", "_").toUpperCase()) ?? Deno.env.get(authRef);
    if (!key) throw new Error(`Missing secret for ${authRef}`);
    url += (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${job.source.name} ${res.status}`);
  const json = await res.json();
 
  const path = job.source.response_items_path || "items";
  let items = getPath(json, path);
  if (!Array.isArray(items)) items = items ? [items] : [];
  return items as unknown[];
}