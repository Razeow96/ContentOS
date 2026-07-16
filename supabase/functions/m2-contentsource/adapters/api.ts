// API adapter. Fetches a JSON REST endpoint (TMDB, watch providers, generic APIs).
// Auth: auth_ref names a secret env var; auth_mode decides how it is attached —
//   "query"  -> appended as ?<auth_param>=<secret>  (default; TMDB uses api_key)
//   "bearer" -> Authorization: Bearer <secret>
// Config-only for any JSON API via url + field_map + response_items_path.

import { getPath } from "../config/fieldmap.ts";
import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { MaterialJob } from "../service/types.ts";

export async function pullApi(job: MaterialJob): Promise<unknown[]> {
  let url = job.url;
  const headers: Record<string, string> = {};
  const authRef = job.source.auth_ref;
  if (authRef) {
    const secret = Deno.env.get(authRef.replaceAll(" ", "_").toUpperCase()) ?? Deno.env.get(authRef);
    if (!secret) throw new Error(`Missing secret for ${authRef}`);
    if ((job.source.auth_mode ?? "query") === "bearer") {
      headers["Authorization"] = `Bearer ${secret}`;
    } else {
      const param = job.source.auth_param ?? "key";
      url += (url.includes("?") ? "&" : "?") + param + "=" + encodeURIComponent(secret);
    }
  }

  const { res, done } = await guardedFetch(url, { headers }, { estimatedRecords: 20 });
  if (!res.ok) throw new Error(`API ${job.source.name} ${res.status}`);
  const json = await res.json();

  const path = job.source.response_items_path || "results";
  let items = getPath(json, path);
  if (!Array.isArray(items)) items = items ? [items] : [];
  await done((items as unknown[]).length);
  return items as unknown[];
}
