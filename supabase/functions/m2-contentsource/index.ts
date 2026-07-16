// m2-contentsource Edge Function — entry point.
// M2 Content Sources: turns reference MATERIAL into SourceEnriched events.
// Modes (POST body.mode):
//   "run"    — scheduled/trend-driven. Build jobs from the catalog + page_material_sources,
//              run in-function API/RSS adapters, normalize, dedup, fan out, write source_events.
//   "ingest" — n8n hands in already-fetched raw items (Bright Data harvest / scrape articles):
//              normalize -> dedup -> emit only.
//   "search" — keyword fan-out across search sources ({query}=keyword). Optional AI match.
//              sink="events" (autonomous trend enrichment, RAZ-26) or "manual"
//              (RAZ-37 manual tool → isolated manual_search_results, no source_events).
//   "harvest_plan" — READ-ONLY (RAZ-36). Resolves page_reference_sources against the
//              Bright Data catalog and hands n8n ready-to-execute jobs. Writes nothing.
//              n8n can't see sources.json (it's bundled here), so the join happens
//              here and n8n stays a pure orchestrator holding zero config. (ADR-001)
// n8n schedules & orchestrates; this function owns all source data. (ADR-001)

import {
  loadCatalog, loadMaterialSubs, buildMaterialJobs, ingestJob, buildSearchJobs,
  loadRefRows, buildHarvestPlan,
} from "./config/config.ts";
import { filterFresh } from "./config/dedup.ts";
import { normalize, fanOut } from "./service/normalize.ts";
import { writeSourceEvents, writeManualResults } from "./service/writer.ts";
import { aiMatch } from "./service/manuel_search_ai.ts";
import { pullApi } from "./adapters/api.ts";
import { pullRss } from "./adapters/rss.ts";
import { pullBrightData } from "./adapters/brightdata.ts";
import type { MaterialJob, RawMaterial } from "./service/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RunBody {
  mode?: "run" | "ingest" | "search" | "harvest_plan";
  trend?: Record<string, unknown> | null;
  source?: string;
  pages?: string[];
  items?: unknown[];
  trigger?: { correlation_id: string; causation_id: string | null } | null;
  // search mode:
  keyword?: string;
  ai_assist?: boolean;
  sink?: "events" | "manual";
  sources?: string[];
  // harvest_plan mode:
  scope?: "daily" | "all";
  ref_ids?: number[];
}

interface Summary {
  pulled: number;
  fresh: number;
  written: number;
  jobs: number;
  sources: Set<string>;
  errors: string[];
  ai?: string;
}

function newSummary(): Summary {
  return { pulled: 0, fresh: 0, written: 0, jobs: 0, sources: new Set(), errors: [] };
}

async function fetchItems(job: MaterialJob, provided?: unknown[]): Promise<unknown[]> {
  if (provided) return provided;                 // ingest: already fetched by n8n
  if (job.source.type === "api") return await pullApi(job);
  if (job.source.type === "rss") return await pullRss(job);
  if (job.source.type === "brightdata") {
    return await pullBrightData(job, Deno.env.get("BRIGHTDATA_API_KEY"), SUPABASE_URL, SERVICE_KEY);
  }
  return [];
}

async function process(job: MaterialJob, provided: unknown[] | undefined, sum: Summary) {
  const items = await fetchItems(job, provided);
  const raw = normalize(job, items);
  sum.pulled += raw.length;
  sum.sources.add(job.source.name);

  const fresh = await filterFresh(raw, SUPABASE_URL, SERVICE_KEY);
  sum.fresh += fresh.length;

  const events = fanOut(job, fresh);
  sum.written += await writeSourceEvents(events, SUPABASE_URL, SERVICE_KEY);
}

async function runSearch(body: RunBody, sum: Summary) {
  const keyword = (body.keyword ?? "").trim();
  if (!keyword) throw new Error("search mode requires a 'keyword'");
  const catalog = loadCatalog();
  const jobs = buildSearchJobs(catalog, keyword, body.sources, body.pages ?? [], body.trend ?? null);
  sum.jobs = jobs.length;

  let raw: RawMaterial[] = [];
  for (const job of jobs) {
    try {
      const items = await fetchItems(job);
      raw.push(...normalize(job, items));
      sum.sources.add(job.source.name);
    } catch (e) {
      sum.errors.push(`${job.source.name}: ${(e as Error).message}`);
    }
  }
  sum.pulled = raw.length;

  if (body.ai_assist) {
    const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (aiKey) {
      raw = await aiMatch(keyword, raw, aiKey);
      sum.ai = "applied";
    } else {
      sum.ai = "skipped_no_key";
    }
  }

  if ((body.sink ?? "events") === "manual") {
    // RAZ-37: isolated store, no dedup, no fan-out, never source_events
    sum.written = await writeManualResults(keyword, !!body.ai_assist, raw, SUPABASE_URL, SERVICE_KEY);
  } else {
    // RAZ-26: autonomous — dedup, fan out per page, write source_events
    const fresh = await filterFresh(raw, SUPABASE_URL, SERVICE_KEY);
    sum.fresh = fresh.length;
    const trig = jobs[0]?.trigger ?? null;
    const pages = body.pages ?? [];
    const events = fresh.flatMap((m) =>
      pages.map((p) => ({
        ...m,
        page: p,
        event_type: "SourceEnriched" as const,
        correlation_id: trig?.correlation_id ?? crypto.randomUUID(),
        causation_id: trig?.causation_id ?? null,
      })),
    );
    sum.written = await writeSourceEvents(events, SUPABASE_URL, SERVICE_KEY);
  }
}

// RAZ-36. Read-only: resolve refs + catalog into work for n8n. Writes nothing.
async function runHarvestPlan(body: RunBody) {
  const refs = await loadRefRows(SUPABASE_URL, SERVICE_KEY, {
    scope: body.scope ?? (body.ref_ids?.length ? "all" : "daily"),
    ref_ids: body.ref_ids,
    pages: body.pages,
  });
  const { jobs, skipped } = buildHarvestPlan(loadCatalog(), refs);
  return {
    ok: true,
    mode: "harvest_plan",
    refs_considered: refs.length,
    jobs,
    skipped,          // surfaced, not swallowed — a ref that can't harvest must be visible
    planned_at: new Date().toISOString(),
  };
}

async function run(body: RunBody) {
  const sum = newSummary();
  const mode = body.mode ?? "run";

  if (mode === "harvest_plan") return await runHarvestPlan(body);

  if (mode === "search") {
    await runSearch(body, sum);
  } else if (mode === "ingest") {
    const catalog = loadCatalog();
    try {
      const job = ingestJob(catalog, body);
      sum.jobs = 1;
      await process(job, body.items ?? [], sum);
    } catch (e) {
      sum.errors.push((e as Error).message);
    }
  } else {
    const catalog = loadCatalog();
    const subs = await loadMaterialSubs(SUPABASE_URL, SERVICE_KEY);
    const jobs = buildMaterialJobs(catalog, subs, body.trend ?? null);
    sum.jobs = jobs.length;
    for (const job of jobs) {
      try {
        await process(job, undefined, sum);
      } catch (e) {
        sum.errors.push(`${job.source.name}: ${(e as Error).message}`);
      }
    }
  }

  return {
    ok: sum.errors.length === 0,
    mode,
    jobs: sum.jobs,
    sources: [...sum.sources],
    material_pulled: sum.pulled,
    material_fresh: sum.fresh,
    written: sum.written,
    ai: sum.ai ?? null,
    errors: sum.errors,
    ran_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  try {
    const body: RunBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const result = await run(body);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 207,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
