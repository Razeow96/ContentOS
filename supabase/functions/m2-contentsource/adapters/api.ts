// API adapter. Fetches a JSON REST endpoint (TMDB, watch providers, generic APIs).
// Auth: auth_ref names a secret env var; auth_mode decides how it is attached —
//   "query"  -> appended as ?<auth_param>=<secret>  (default; TMDB uses api_key)
//   "bearer" -> Authorization: Bearer <secret>
// Config-only for any JSON API via url + field_map + response_items_path.

import { getPath } from "../config/fieldmap.ts";
import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { MaterialJob, MaterialSource, RawMaterial } from "../service/types.ts";

// Resolve the source's secret and attach it per auth_mode. Shared by every
// API-shaped call in this file so auth semantics can never drift between them.
function applyAuth(src: MaterialSource, url: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const authRef = src.auth_ref;
  if (authRef) {
    const secret = Deno.env.get(authRef.replaceAll(" ", "_").toUpperCase()) ?? Deno.env.get(authRef);
    if (!secret) throw new Error(`Missing secret for ${authRef}`);
    if ((src.auth_mode ?? "query") === "bearer") {
      headers["Authorization"] = `Bearer ${secret}`;
    } else {
      const param = src.auth_param ?? "key";
      url += (url.includes("?") ? "&" : "?") + param + "=" + encodeURIComponent(secret);
    }
  }
  return { url, headers };
}

export async function pullApi(job: MaterialJob): Promise<unknown[]> {
  const { url, headers } = applyAuth(job.source, job.url);

  const { res, done } = await guardedFetch(url, { headers }, { estimatedRecords: 20 });
  if (!res.ok) throw new Error(`API ${job.source.name} ${res.status}`);
  const json = await res.json();

  const path = job.source.response_items_path || "results";
  let items = getPath(json, path);
  if (!Array.isArray(items)) items = items ? [items] : [];
  await done((items as unknown[]).length);
  return items as unknown[];
}

// RAZ-24 · watch-provider enrichment. Driven BY movie material, never standalone:
// the TMDB endpoint is per-movie ({movie_id}) and returns availability keyed by
// country, so it hangs off fresh movie items and the subscription's with_providers
// value IS the country key. Runs AFTER dedup on purpose — only movies that will
// actually be emitted cost a call. One movie's failure must not strip availability
// from the rest, so errors collect per-movie and the loop continues.
interface ProviderEntry {
  link?: string;
  flatrate?: { provider_name?: string }[];
  rent?: { provider_name?: string }[];
  buy?: { provider_name?: string }[];
}

export async function enrichWatchProviders(
  src: MaterialSource,          // the tmdb_watch_providers catalog entry (url + auth config)
  materials: RawMaterial[],
  region: string,
  errors: string[],
): Promise<void> {
  const names = (a?: { provider_name?: string }[]) =>
    (a ?? []).map((p) => p.provider_name).filter((n): n is string => !!n);

  for (const m of materials) {
    if (!m.external_id) continue;
    try {
      const { url, headers } = applyAuth(
        src,
        src.url.replaceAll("{movie_id}", encodeURIComponent(m.external_id)),
      );
      const { res, done } = await guardedFetch(url, { headers }, { estimatedRecords: 1 });
      if (!res.ok) throw new Error(`API ${src.name} ${res.status}`);
      const json = (await res.json()) as { results?: Record<string, ProviderEntry> };
      await done(1);

      // Region entry absent = checked, nothing available there. Still attached (with
      // empty arrays) so generation can tell "not on streaming" from "never checked".
      const entry = json.results?.[region];
      m.enrichment = {
        ...(m.enrichment ?? {}),
        watch_providers: {
          region,
          link: entry?.link ?? null,       // TMDB/JustWatch attribution URL
          flatrate: names(entry?.flatrate),
          rent: names(entry?.rent),
          buy: names(entry?.buy),
        },
      };
    } catch (e) {
      errors.push(`watch_providers ${m.external_id}: ${(e as Error).message}`);
    }
  }
}
