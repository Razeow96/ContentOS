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
//   "promote" — RAZ-37. The ONLY bridge out of the isolated manual_search_results store:
//              operator-chosen rows -> SourceEnriched -> source_events -> M3. Human-initiated,
//              so it mints a fresh correlation_id and causation_id is null.
//   "search_plan" — READ-ONLY. Async twin of "search" for Bright Data keyword DISCOVERY,
//              which cannot finish in the sync budget (measured 112.6s, 0 records). Hands n8n
//              a ready-to-call /trigger job; the worker echoes sink+keyword back to "ingest".
//   "harvest_plan" — RAZ-36/RAZ-43. Resolves page_reference_sources against the
//              Bright Data catalog and hands n8n ready-to-execute jobs. n8n can't see
//              sources.json (bundled here), so the join happens here and n8n stays a
//              pure orchestrator holding zero config. (ADR-001)
//              ⚠ NOT read-only on the due path: scope "due" (alias "daily") atomically
//              CLAIMS due rows via ref_harvest_claim() — next_run_at advances. Scopes
//              "all"/"triggered"/ref_ids picks are read-only.
// n8n schedules & orchestrates; this function owns all source data. (ADR-001)

import {
  loadCatalog, loadMaterialSubs, buildMaterialJobs, ingestJob, buildSearchJobs,
  loadRefRows, buildHarvestPlan, buildSearchPlan, loadArticleRows, buildArticleJobs,
} from "./config/config.ts";
import { filterFresh } from "./config/dedup.ts";
import { normalize, fanOut, applyStrategy } from "./service/normalize.ts";
import { writeSourceEvents, writeManualResults } from "./service/writer.ts";
import { aiMatch } from "./service/manuel_search_ai.ts";
import { pullApi, enrichWatchProviders } from "./adapters/api.ts";
import { pullRss } from "./adapters/rss.ts";
import { pullScrape } from "./adapters/scrape.ts";
import { pullBrightData } from "./adapters/brightdata.ts";
import type { MaterialJob, RawMaterial, RefRow } from "./service/types.ts";
import { withRun } from "../m0-infrastructure/observability/runlog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RunBody {
  mode?: "run" | "ingest" | "search" | "harvest_plan" | "search_plan" | "promote";
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
  video_type?: string | null;   // bd_input=search_filters toggle: "Video" | "Shorts" | omit = both
  // promote mode:
  ids?: number[];               // manual_search_results row ids the operator chose
  // harvest_plan mode. "due" = claim+advance (canonical); "daily" = deployed-dispatcher
  // alias for "due"; "all"/"triggered" and ref_ids picks are read-only. Any other
  // string is a 400 — an unrecognized scope must never silently widen the selection.
  scope?: "due" | "daily" | "all" | "triggered";
  ref_ids?: number[];
  // ingest mode, RAZ-36: n8n echoes these back from the harvest_plan job so the
  // per-ref strategy is applied without re-reading page_reference_sources.
  strategy?: string;
  window_days?: number | null;
  cap?: number | null;
  // RAZ-43: echoed back by the worker from the harvest_plan job — inspiration class
  // stamped onto the emitted material. (trigger echoes too; consumed by ingestJob.)
  ref_kind?: string;
  // RAZ-66: trend_events DB webhook delivery shape. When present, this request is the
  // M2 trend consumer (dedup src_processed → search), not a mode-based call.
  type?: string;
  table?: string;
  record?: { event_id: string; payload?: { topic?: string; page?: string; correlation_id?: string; trend_signal_id?: string } };
}

interface Summary {
  pulled: number;
  selected: number;
  fresh: number;
  written: number;
  jobs: number;
  sources: Set<string>;
  errors: string[];
  ai?: string;
}

function newSummary(): Summary {
  return { pulled: 0, selected: 0, fresh: 0, written: 0, jobs: 0, sources: new Set(), errors: [] };
}

async function fetchItems(job: MaterialJob, provided?: unknown[]): Promise<unknown[]> {
  if (provided) return provided;                 // ingest: already fetched by n8n
  if (job.source.type === "api") return await pullApi(job);
  if (job.source.type === "rss") return await pullRss(job);
  if (job.source.type === "scrape") return await pullScrape(job);
  if (job.source.type === "brightdata") {
    return await pullBrightData(job, Deno.env.get("BRIGHTDATA_API_KEY"), SUPABASE_URL, SERVICE_KEY);
  }
  return [];
}

async function process(
  job: MaterialJob,
  provided: unknown[] | undefined,
  sum: Summary,
  sel?: {
    strategy?: string;
    window_days?: number | null;
    cap?: number | null;
    sink?: "events" | "manual";
    keyword?: string;
    ai_assist?: boolean;
    ref_kind?: "competitor" | "lifestyle";
  },
) {
  const items = await fetchItems(job, provided);
  const raw = normalize(job, items);
  sum.pulled += raw.length;
  sum.sources.add(job.source.name);

  // sink=manual: the async search path calling back (search_plan → worker → ingest). Mirror
  // runSearch's manual branch exactly — isolated store, no dedup, no fan-out, never
  // source_events — so an async search behaves identically to a sync one.
  if (sel?.sink === "manual") {
    sum.selected += raw.length;
    sum.written += await writeManualResults(
      sel.keyword ?? "",
      !!sel.ai_assist,
      raw,
      SUPABASE_URL,
      SERVICE_KEY,
    );
    return;
  }

  // RAZ-36: apply the ref's strategy before dedup, so only the chosen posts are emitted.
  const chosen = sel?.strategy ? applyStrategy(raw, sel.strategy, sel.window_days, sel.cap) : raw;
  sum.selected += chosen.length;

  const fresh = await filterFresh(chosen, SUPABASE_URL, SERVICE_KEY);
  sum.fresh += fresh.length;

  // RAZ-24: attach streaming availability onto fresh movie material when the
  // subscription opts in (params.with_providers = the TMDB country key, e.g. "TW").
  // After dedup on purpose: only material that will actually be emitted costs a
  // per-movie call. A requested-but-disabled enrichment source fails loudly — a
  // silent skip would emit movie events that just quietly lack availability.
  const wpRegion = job.params.with_providers;
  if (wpRegion && job.source.material_type === "movie" && fresh.length > 0) {
    const wp = loadCatalog().find((s) => s.name === "tmdb_watch_providers");
    if (wp?.enabled) {
      await enrichWatchProviders(wp, fresh, wpRegion, sum.errors);
    } else {
      sum.errors.push(`with_providers=${wpRegion} requested but tmdb_watch_providers is disabled`);
    }
  }

  // RAZ-43: stamp the inspiration class onto the emitted material. Payload is
  // field-extensible by contract (jsonb + field_map), so no schema bump. Typed on
  // RawMaterial (no cast) so a field-explicit refactor cannot silently drop it.
  if (sel?.ref_kind) {
    for (const m of fresh) m.ref_kind = sel.ref_kind;
  }

  const events = fanOut(job, fresh);
  sum.written += await writeSourceEvents(events, SUPABASE_URL, SERVICE_KEY);
}

async function runSearch(body: RunBody, sum: Summary) {
  const keyword = (body.keyword ?? "").trim();
  if (!keyword) throw new BadRequest("search mode requires a 'keyword'");
  const catalog = loadCatalog();
  const jobs = buildSearchJobs(catalog, keyword, body.sources, body.pages ?? [], body.trend ?? null, body.video_type);
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
    // RAZ-72: the trend consumer passes trend_signal_id on body.trend — stamp it onto
    // every emitted source event (null on a non-trend search).
    const trendSignalId = (body.trend?.trend_signal_id as string | undefined) ?? null;
    const pages = body.pages ?? [];
    const events = fresh.flatMap((m) =>
      pages.map((p) => ({
        ...m,
        page: p,
        event_type: "SourceEnriched" as const,
        correlation_id: trig?.correlation_id ?? crypto.randomUUID(),
        causation_id: trig?.causation_id ?? null,
        trend_signal_id: trendSignalId,
      })),
    );
    sum.written = await writeSourceEvents(events, SUPABASE_URL, SERVICE_KEY);
  }
}

// RAZ-37 · promote — the ONLY bridge out of the isolated manual store.
//
// manual_search_results is deliberately a dead-end (a plain ops table, NOT a domain stream):
// exploration must never auto-feed Content Generation. This is the single, explicit HUMAN step
// that moves chosen material into the real flow: rows -> SourceEnriched -> source_events -> M3.
//
// correlation_id: ONE fresh id per promote call. A promotion is the HEAD of a new flow — a human
// started it, no event caused it — so causation_id is null (unlike the trend consumer, where the
// TrendDetected event_id is the cause).
async function runPromote(body: RunBody, sum: Summary) {
  const ids = body.ids ?? [];
  if (ids.length === 0) throw new BadRequest("promote mode requires 'ids' (manual_search_results row ids)");
  const pages = body.pages ?? [];
  if (pages.length === 0) {
    throw new BadRequest("promote mode requires 'pages' — promoted material must land on at least one page");
  }

  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  // status=eq.new makes this idempotent: promoting the same row twice reads nothing the 2nd time.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/manual_search_results?id=in.(${ids.join(",")})&status=eq.new&select=id,payload`,
    { headers: h },
  );
  if (!res.ok) throw new Error(`read manual_search_results ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as { id: number; payload: RawMaterial }[];

  sum.jobs = rows.length;
  sum.pulled = rows.length;
  if (rows.length === 0) return; // nothing new to promote (already promoted, or bad ids)

  const materials = rows.map((r) => r.payload);
  for (const m of materials) sum.sources.add(m.source);
  sum.selected = materials.length;

  // Same freshness invariant as every other path — a promote must not duplicate material
  // already in the stream for this window. Deduped rows are still marked promoted (the human
  // did choose them); the summary reports the gap so it never looks like a silent failure.
  const fresh = await filterFresh(materials, SUPABASE_URL, SERVICE_KEY);
  sum.fresh = fresh.length;

  const correlationId = crypto.randomUUID();
  const events = fresh.flatMap((m) =>
    pages.map((p) => ({
      ...m,
      page: p,
      event_type: "SourceEnriched" as const,
      correlation_id: correlationId,
      causation_id: null,
    }))
  );
  sum.written = await writeSourceEvents(events, SUPABASE_URL, SERVICE_KEY);

  // Flip AFTER the events are safely written — if the write throws, the rows stay `new` and the
  // operator can retry. The reverse order would lose the material with nothing in the stream.
  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/manual_search_results?id=in.(${rows.map((r) => r.id).join(",")})`,
    {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "promoted" }),
    },
  );
  if (!patch.ok) {
    // Events are already out — surface it rather than pretend. Re-promoting is safe: filterFresh
    // will drop the duplicates, so a retry emits nothing new.
    sum.errors.push(`promoted ${sum.written} event(s) but status update failed: ${patch.status}`);
  }
}

// RAZ-36/RAZ-43 (rewritten after 2026-07-19 review). Resolves refs + catalog into
// work for n8n. Scheduler state lives fully in SQL:
//   scope "due" ("daily" = deployed-dispatcher alias) -> ref_harvest_claim() —
//     ONE atomic statement claims due rows AND advances next_run_at on the slot grid
//     (gate-joined, FOR UPDATE SKIP LOCKED). No race, no drift, no partial advance,
//     no swallowed per-row failure: a claim that fails plans nothing and moves nothing.
//   scope "all" / ref_ids picks -> read-only, nothing advances.
//   scope "triggered" -> read-only; REQUIRES pages + trend (a triggered pull without
//     a page narrowing would fire every trigger_rule row on every trend — paid BD jobs;
//     without trend, its events would carry no lineage).
// Trend lineage is stamped ONLY on triggered plans — a stray trend on a due plan must
// not write false correlation ids into the append-only stream.
async function runHarvestPlan(body: RunBody) {
  const requested = body.scope ?? (body.ref_ids?.length ? "all" : "due");
  const scope = requested === "daily" ? "due" : requested;
  if (scope !== "due" && scope !== "all" && scope !== "triggered") {
    throw new BadRequest(`unknown harvest_plan scope "${requested}" — use due | all | triggered`);
  }

  let refs: RefRow[];
  let advanced = 0;
  if (scope === "due") {
    refs = await claimDueRefs();
    advanced = refs.length;   // claim and advance are the same statement
  } else {
    if (scope === "triggered") {
      if (!body.pages?.length) throw new BadRequest("triggered scope requires 'pages'");
      if (!body.trend) throw new BadRequest("triggered scope requires 'trend' (correlation lineage)");
    }
    refs = await loadRefRows(SUPABASE_URL, SERVICE_KEY, {
      scope,
      ref_ids: body.ref_ids,
      pages: body.pages,
    });
  }

  const trend = scope === "triggered" ? body.trend ?? null : null;
  const { jobs, skipped } = buildHarvestPlan(loadCatalog(), refs, trend);

  return {
    ok: true,
    mode: "harvest_plan",
    scope,
    refs_considered: refs.length,
    jobs,
    skipped,          // surfaced, not swallowed — a ref that can't harvest must be visible
    advanced,         // due rows atomically claimed+advanced (0 on read-only scopes)
    planned_at: new Date().toISOString(),
  };
}

// RAZ-43: the due path. ref_harvest_claim() (20260718_raz43_reference_cadence.sql) owns
// selection + advancement atomically — same layering as api_gate_acquire (M0).
async function claimDueRefs(): Promise<RefRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ref_harvest_claim`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`ref_harvest_claim failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RefRow[];
}

async function run(body: RunBody) {
  const sum = newSummary();
  const mode = body.mode ?? "run";

  if (mode === "harvest_plan") return await runHarvestPlan(body);

  // Read-only twin of harvest_plan for keyword DISCOVERY. Writes nothing; hands n8n a
  // ready-to-execute /trigger job because discovery cannot finish inside the sync budget.
  if (mode === "search_plan") {
    const keyword = (body.keyword ?? "").trim();
    if (!keyword) throw new BadRequest("search_plan mode requires a 'keyword'");
    const { jobs, skipped } = buildSearchPlan(loadCatalog(), keyword, body.sources, {
      videoType: body.video_type,
      cap: body.cap,
      sink: body.sink ?? "manual",
      aiAssist: body.ai_assist,
    });
    return {
      ok: true,
      mode: "search_plan",
      keyword,
      jobs,
      skipped,          // surfaced, not swallowed — same rule as harvest_plan
      planned_at: new Date().toISOString(),
    };
  }

  if (mode === "promote") {
    await runPromote(body, sum);
  } else if (mode === "search") {
    await runSearch(body, sum);
  } else if (mode === "ingest") {
    const catalog = loadCatalog();
    try {
      const job = ingestJob(catalog, body);
      sum.jobs = 1;
      await process(job, body.items ?? [], sum, {
        strategy: body.strategy,
        window_days: body.window_days,
        cap: body.cap,
        // Echoed back by the worker from the search_plan job (absent on harvest = events).
        sink: body.sink,
        keyword: body.keyword,
        ai_assist: body.ai_assist,
        // RAZ-43: echoed from the harvest_plan job — stamped onto the emitted material.
        // Validated against the contract enum: the append-only stream must never store
        // a mangled echo (review finding 2026-07-19). Invalid values are surfaced, not
        // silently written or silently dropped.
        ref_kind: body.ref_kind === "competitor" || body.ref_kind === "lifestyle"
          ? body.ref_kind
          : (body.ref_kind !== undefined
              ? (sum.errors.push(`ignoring invalid ref_kind "${body.ref_kind}"`), undefined)
              : undefined),
      });
    } catch (e) {
      sum.errors.push((e as Error).message);
    }
  } else {
    const catalog = loadCatalog();
    const [subs, articles] = await Promise.all([
      loadMaterialSubs(SUPABASE_URL, SERVICE_KEY),
      loadArticleRows(SUPABASE_URL, SERVICE_KEY),
    ]);
    // API/listing subscriptions + RAZ-25 article feeds. Same run, same normalize/dedup/emit —
    // an article feed is just another material source, which is the point of the contract.
    const jobs = [
      ...buildMaterialJobs(catalog, subs, body.trend ?? null),
      ...buildArticleJobs(catalog, articles, body.trend ?? null),
    ];
    sum.jobs = jobs.length;
    for (const job of jobs) {
      try {
        await process(job, undefined, sum);
      } catch (e) {
        // One bad feed must not kill the rest of the run.
        sum.errors.push(`${job.source.name}${job.url ? ` (${job.url})` : ""}: ${(e as Error).message}`);
      }
    }
  }

  return {
    ok: sum.errors.length === 0,
    mode,
    jobs: sum.jobs,
    sources: [...sum.sources],
    material_pulled: sum.pulled,
    material_selected: sum.selected,
    material_fresh: sum.fresh,
    written: sum.written,
    ai: sum.ai ?? null,
    errors: sum.errors,
    ran_at: new Date().toISOString(),
  };
}

// The AR-1 admin app is a BROWSER caller, so this function needs CORS or the preflight
// fails before any request reaches us. Origin "*" is safe here: the bearer key is still
// required, so CORS is not the access control — the key is.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

// Bad INPUT is the caller's fault (400), a thrown adapter/DB error is ours (500).
// Collapsing both into 500 made "promote without pages" look like a server crash.
class BadRequest extends Error {}

const resp = (body: unknown, status: number) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });

// ── In-domain subscribers (RAZ-66/68). These fold what were separate n8n workflows
// (and my earlier stray m2-trend-consumer/m2-harvest-ingest functions) into the M2
// domain fn, per the one-domain-one-function rule.

const INGEST_SECRET = Deno.env.get("HARVEST_INGEST_SECRET") ?? "";

// Atomic idempotency guard on a seen-log — one INSERT ... ON CONFLICT DO NOTHING.
async function claimFirstDelivery(seenTable: string, eventId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${seenTable}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({ event_id: eventId }),
  });
  if (!res.ok) throw new Error(`${seenTable} insert ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// BD delivers gzip by default; we ask uncompressed, but decode defensively.
async function readRawText(req: Request): Promise<string> {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length === 0) return "";
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

// RAZ-68 · Bright Data push-delivery receiver (ingest=harvest route). Auth = the
// shared secret `k` (BD passes the gateway with the anon key in auth_header). The job
// echo is in the query; BD's POST body is the scraped data.
async function harvestIngest(req: Request, u: URL, rl: { action?: string; status?: string; correlation_id?: string | null; summary?: unknown }) {
  const sp = u.searchParams;
  if (!INGEST_SECRET || sp.get("k") !== INGEST_SECRET) {
    rl.action = "harvest_ingest_unauthorized";
    rl.status = "error";
    return resp({ ok: false, error: "unauthorized" }, 401);
  }
  const text = await readRawText(req);
  let items: unknown[] = [];
  if (text.trim()) {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed
      : Array.isArray((parsed as { data?: unknown[] }).data) ? (parsed as { data: unknown[] }).data
      : [parsed];
  }
  const correlation_id = sp.get("correlation_id");
  const body: RunBody = {
    mode: "ingest",
    source: sp.get("source") ?? undefined,
    pages: sp.get("page_id") ? [sp.get("page_id") as string] : [],
    strategy: sp.get("strategy") ?? undefined,
    window_days: sp.get("window_days") ? Number(sp.get("window_days")) : undefined,
    cap: sp.get("cap") ? Number(sp.get("cap")) : undefined,
    ref_kind: sp.get("ref_kind") ?? undefined,
    trigger: correlation_id ? { correlation_id, causation_id: sp.get("causation_id") || null } : null,
    items,
  };
  const result = await run(body);
  rl.action = "harvest_ingest";
  rl.correlation_id = correlation_id;
  rl.summary = { source: body.source, items: items.length, written: (result as { written?: number }).written };
  rl.status = (result as { ok?: boolean }).ok ? "ok" : "error";
  return resp({ ok: true, source: body.source, items: items.length, ingest: result }, 200);
}

// RAZ-66 · M2 trend consumer (trend_events DB webhook). Dedup on src_processed →
// keyword search (sink=events), carrying the trend's correlation + causation lineage.
async function trendConsume(body: RunBody, rl: { action?: string; status?: string; correlation_id?: string | null; summary?: unknown }) {
  const rec = body.record!;
  const p = rec.payload ?? {};
  if (!p.topic || !p.page) {
    rl.action = "skip";
    rl.status = "skip";
    return resp({ ok: true, event_id: rec.event_id, outcome: "skip", reason: "event missing payload.topic/page" }, 200);
  }
  const first = await claimFirstDelivery("src_processed", rec.event_id);
  if (!first) {
    rl.action = "duplicate_skipped";
    rl.status = "skip";
    rl.correlation_id = p.correlation_id ?? null;
    return resp({ ok: true, event_id: rec.event_id, outcome: "duplicate_skipped" }, 200);
  }
  const searchBody: RunBody = {
    mode: "search",
    keyword: p.topic,
    sink: "events",
    pages: [p.page],
    // RAZ-72: thread the trend's signal id onto the compiled source events so a
    // draft traces back to the campaign that produced it.
    trend: { correlation_id: p.correlation_id, event_id: rec.event_id, trend_signal_id: p.trend_signal_id },
  };
  const result = await run(searchBody);
  rl.action = "trend_consume";
  rl.correlation_id = p.correlation_id ?? null;
  rl.summary = result;
  rl.status = (result as { ok?: boolean }).ok ? "ok" : "error";
  return resp({ ok: true, event_id: rec.event_id, outcome: "enriched", enrich: result }, 200);
}

Deno.serve((req) => {
  // OPTIONS preflight is not a run — keep it out of the log entirely.
  if (req.method === "OPTIONS") return Promise.resolve(new Response(null, { status: 204, headers: CORS }));
  return withRun("m2-contentsource", req, async (rl) => {
    // RAZ-68: Bright Data push-delivery of a harvest snapshot (raw data body).
    const u = new URL(req.url);
    if (u.searchParams.get("ingest") === "harvest") return await harvestIngest(req, u, rl);
    try {
      // A body that fails to parse must NOT fall through to mode="run": that default
      // pulls every subscribed API source and writes real events, so a malformed
      // request silently performed a full TMDB pull instead of erroring (caught
      // 2026-07-16 — it wrote 40 junk events). Bad input fails loudly now.
      let body: RunBody = {};
      if (req.method === "POST") {
        const text = await req.text();
        if (text.trim() !== "") {
          try {
            body = JSON.parse(text);
          } catch (e) {
            return resp({ ok: false, error: `Body is not valid JSON: ${(e as Error).message}`, bytes_received: text.length }, 400);
          }
        }
      }
      // RAZ-66: trend_events DB webhook → the M2 trend consumer.
      if (body.type === "INSERT" && body.table === "trend_events" && body.record?.event_id) {
        return await trendConsume(body, rl);
      }
      const result = await run(body);
      rl.action = body.mode ?? "run";
      rl.summary = result;
      rl.correlation_id = body.trigger?.correlation_id ??
        (body.trend?.correlation_id as string | undefined) ?? null;
      rl.status = result.ok ? "ok" : "error";
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 207,
        headers: JSON_HEADERS,
      });
    } catch (e) {
      const bad = e instanceof BadRequest;
      return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
        status: bad ? 400 : 500,
        headers: JSON_HEADERS,
      });
    }
  });
});
