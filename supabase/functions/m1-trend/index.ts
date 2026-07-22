// m1-trend Edge Function — entry point.
// Orchestrates: load config -> build pull jobs -> run adapters -> normalize
// -> dedup -> fan out -> write to trend_events -> return summary.
// n8n only calls this daily and reports the summary. n8n never touches trend data.

import { loadSources, loadSubscriptions, buildPullJobs } from "./config/config.ts";
import { filterFresh } from "./config/dedup.ts";
import { normalize, fanOut } from "./service/normalize.ts";
import { writeTrendEvents } from "./service/writer.ts";
import { pullRss } from "./adapters/rss.ts";
import { pullApi } from "./adapters/api.ts";
import { pullScrape } from "./adapters/scraper.ts";
import type { PullJob } from "./service/types.ts";
import { withRun } from "../m0-infrastructure/observability/runlog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function runJob(job: PullJob) {
  const t = job.source.type;
  if (t === "rss") return await pullRss(job);
  if (t === "api") return await pullApi(job);
  if (t === "scrape") return await pullScrape(job);
  return [];
}

async function run() {
  const summary = { pulled: 0, fresh: 0, written: 0, jobs: 0, platforms: new Set<string>(), errors: [] as string[] };

  // RAZ-72: ONE trend_signal_id per campaign run — the head of the ID spine.
  // Every trend detected in this run carries it; downstream (M2, M3) copies it so
  // a draft traces back to the campaign that produced it.
  const trendSignalId = crypto.randomUUID();

  const [sources, subs] = await Promise.all([
    loadSources(),
    loadSubscriptions(SUPABASE_URL, SERVICE_KEY),
  ]);
  const jobs = buildPullJobs(sources, subs);
  summary.jobs = jobs.length;

  for (const job of jobs) {
    try {
      const items = await runJob(job);
      const raw = normalize(job, items);
      summary.pulled += raw.length;
      summary.platforms.add(job.source.name);

      const fresh = await filterFresh(raw, SUPABASE_URL, SERVICE_KEY);
      summary.fresh += fresh.length;

      const events = fanOut(job, fresh, trendSignalId);
      const n = await writeTrendEvents(events, SUPABASE_URL, SERVICE_KEY);
      summary.written += n;
    } catch (e) {
      summary.errors.push(`${job.source.name}: ${(e as Error).message}`);
    }
  }

  return {
    ok: summary.errors.length === 0,
    trend_signal_id: trendSignalId,
    jobs: summary.jobs,
    platforms: [...summary.platforms],
    trends_pulled: summary.pulled,
    trends_fresh: summary.fresh,
    events_written: summary.written,
    errors: summary.errors,
    ran_at: new Date().toISOString(),
  };
}

Deno.serve((req) =>
  withRun("m1-trend", req, async (rl) => {
    try {
      const result = await run();
      rl.action = "run";
      rl.summary = result;
      rl.status = result.ok ? "ok" : "error";
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  })
);
