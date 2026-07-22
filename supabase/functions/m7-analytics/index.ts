// m7-analytics Edge Function — RAZ-69 (epic RAZ-63).
// Replaces the n8n FB-engagement seed (RAZ-19). Collects Facebook engagement for
// recently-posted rows into post_metrics — but as real code: every Graph call goes
// through guardedFetch (the rate-limit gate; the n8n seed called Graph raw), and the
// whole run is one withRun invocation instead of a per-post n8n loop holding all rows
// in memory.
//
// Scheduled by pg_cron or an n8n trigger (owner's call). Reads posted rows +
// page_tokens (service-role); writes a fresh post_metrics snapshot row per post.

import { withRun } from "../m0-infrastructure/observability/runlog.ts";
import { guardedFetch, RateLimitDenied } from "../m0-infrastructure/rate-limit/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v23.0";
const FIELDS = "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

const rest = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

interface PostedRow { id: number; page: string; post_id: string; posted_at: string; }

// Recently-posted rows that carry a real FB post_id, newest first. `limit` bounds
// one invocation (at 50 pages a scheduler pages by shrinking the window); the n8n
// seed held the entire result set in memory with no bound.
async function loadPosted(sinceDays: number, limit: number): Promise<PostedRow[]> {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const q = rest(`content_queue?status=eq.posted&post_id=not.is.null&posted_at=gt.${cutoff}` +
    `&select=id,page,post_id,posted_at&order=posted_at.desc&limit=${limit}`);
  const res = await fetch(q, { headers: svc });
  if (!res.ok) throw new Error(`load posted ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as PostedRow[];
}

// One token per page. Never logged.
async function loadTokens(pages: string[]): Promise<Record<string, string>> {
  if (pages.length === 0) return {};
  const inList = pages.map((p) => `"${p}"`).join(",");
  const res = await fetch(rest(`page_tokens?page=in.(${inList})&select=page,fb_token`), { headers: svc });
  if (!res.ok) throw new Error(`load page_tokens ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const rows = (await res.json()) as { page: string; fb_token: string | null }[];
  const map: Record<string, string> = {};
  for (const r of rows) if (r.fb_token) map[r.page] = r.fb_token;
  return map;
}

async function insertMetrics(rows: { post_id: string; page: string; metrics: unknown }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await fetch(rest("post_metrics"), {
    method: "POST",
    headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert post_metrics ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return rows.length;
}

async function handle(body: { since_days?: number; limit?: number }) {
  const sinceDays = body.since_days ?? 7;
  const limit = Math.min(body.limit ?? 150, 500);

  const posted = await loadPosted(sinceDays, limit);
  const tokens = await loadTokens([...new Set(posted.map((p) => p.page))]);

  const out: { post_id: string; page: string; metrics: unknown }[] = [];
  const errors: string[] = [];
  let denied = false;

  for (const row of posted) {
    const token = tokens[row.page];
    if (!token) { errors.push(`${row.page}/${row.post_id}: no fb_token for page`); continue; }
    try {
      const url = `${GRAPH}/${encodeURIComponent(row.post_id)}?fields=${encodeURIComponent(FIELDS)}`;
      const { res, done } = await guardedFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { estimatedRecords: 1 });
      const data = await res.json();
      await done(1);
      if (!res.ok) { errors.push(`${row.post_id}: graph ${res.status} ${JSON.stringify(data).slice(0, 120)}`); continue; }
      out.push({ post_id: row.post_id, page: row.page, metrics: data });
    } catch (e) {
      if (e instanceof RateLimitDenied) { denied = true; errors.push(`gate denied: ${e.message} — stopping`); break; }
      errors.push(`${row.post_id}: ${(e as Error).message}`);
    }
  }

  const inserted = await insertMetrics(out);
  return {
    eligible: posted.length,
    collected: out.length,
    inserted,
    denied,
    errors,
    ran_at: new Date().toISOString(),
  };
}

Deno.serve((req) =>
  withRun("m7-analytics", req, async (rl) => {
    let body: { since_days?: number; limit?: number } = {};
    if (req.method === "POST") {
      const text = await req.text();
      if (text.trim()) {
        try { body = JSON.parse(text); } catch (e) {
          return json({ ok: false, error: `body not JSON: ${(e as Error).message}` }, 400);
        }
      }
    }
    const result = await handle(body);
    rl.action = "fb_engagement";
    rl.summary = result;
    rl.status = result.errors.length && result.collected === 0 ? "error" : "ok";
    return json({ ok: true, ...result }, 200);
  })
);
