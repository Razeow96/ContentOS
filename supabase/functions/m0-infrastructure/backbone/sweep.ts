// M0 · backbone safety sweep (RAZ-70). Re-delivers events never marked seen (a
// dropped webhook) to their domain consumer, and surfaces backbone health (unseen
// counts, dead_letter) — the /admin observability surface, no Telegram.
//
// Lives INSIDE the m0-infrastructure domain (invariant: one domain = one function).
// Invoked via the gate endpoint action:"sweep"; scheduled by pg_cron or a thin n8n
// trigger. Re-delivery target is the domain consumer function (m2-contentsource /
// m3-generate), which the DB webhook now points at.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const rest = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`;
const fn = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

// One entry per aggregate stream: table, its seen-log, and the domain function the
// DB webhook now targets. content_events has no consumer until Publishing/M4 (RAZ-64).
const STREAMS = [
  { table: "trend_events", seen: "src_processed", consumer: "m2-contentsource" },
  { table: "source_events", seen: "gen_processed", consumer: "m3-generate" },
];

interface EventRow {
  event_id: string;
  event_type?: string;
  payload?: { correlation_id?: string; [k: string]: unknown };
}

async function findUnseen(table: string, seen: string, graceIso: string, lookbackIso: string, cap: number): Promise<EventRow[]> {
  const q = rest(`${table}?occurred_at=lt.${graceIso}&occurred_at=gt.${lookbackIso}` +
    `&order=occurred_at.desc&limit=300` +
    `&select=event_id,event_type,payload,occurred_at,correlation_id,causation_id,aggregate_id,schema_version`);
  const res = await fetch(q, { headers: svc });
  if (!res.ok) throw new Error(`read ${table} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const rows = (await res.json()) as EventRow[];
  if (rows.length === 0) return [];

  // Chunk the seen-log membership check so the in.(...) URL never breaks HTTP/2.
  const seenSet = new Set<string>();
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => `"${r.event_id}"`).join(",");
    const sres = await fetch(rest(`${seen}?event_id=in.(${ids})&select=event_id`), { headers: svc });
    if (!sres.ok) throw new Error(`read ${seen} ${sres.status}: ${(await sres.text()).slice(0, 160)}`);
    for (const r of (await sres.json()) as { event_id: string }[]) seenSet.add(r.event_id);
  }
  return rows.filter((r) => !seenSet.has(r.event_id)).slice(0, cap);
}

// Fire-and-(nearly)-forget. A safety sweep must NOT block on consumer processing
// time — m3-generate can take 30s+ per event, and awaiting many sequentially blows
// the edge wall-time (546). We only need to DELIVER the request; the consumer dedups
// on its seen-log and runs to completion on its own invocation. So abort our wait
// after 3s (the request is already delivered) and treat that as dispatched.
async function redeliver(consumer: string, table: string, record: EventRow): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(fn(consumer), {
      method: "POST",
      headers: { ...svc, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "INSERT", table, record }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.status >= 200 && res.status < 300 ? "ok" : `http_${res.status}`;
  } catch (e) {
    clearTimeout(t);
    return (e as Error).name === "AbortError" ? "dispatched" : "error";
  }
}

async function deadLetterCount(): Promise<number | null> {
  try {
    const res = await fetch(rest("dead_letter?select=id&limit=1000"), { headers: svc });
    if (!res.ok) return null;
    return ((await res.json()) as unknown[]).length;
  } catch {
    return null;
  }
}

export async function runSweep(body: { dry_run?: boolean; age_minutes?: number; lookback_hours?: number; max_per_stream?: number }) {
  const dryRun = body.dry_run ?? false;
  const ageMin = body.age_minutes ?? 10;
  const lookbackHours = body.lookback_hours ?? 24;
  const cap = Math.min(body.max_per_stream ?? 100, 500);
  const graceIso = new Date(Date.now() - ageMin * 60000).toISOString();
  const lookbackIso = new Date(Date.now() - lookbackHours * 3600000).toISOString();

  const streams: Record<string, unknown> = {};
  let totalUnseen = 0;
  let totalRedelivered = 0;

  for (const s of STREAMS) {
    const unseen = await findUnseen(s.table, s.seen, graceIso, lookbackIso, cap);
    totalUnseen += unseen.length;
    let redelivered = 0;
    const tally: Record<string, number> = {};
    if (!dryRun) {
      // Fire all re-deliveries concurrently so the sweep finishes in ~3s regardless
      // of how many events (and regardless of downstream generation time).
      const results = await Promise.all(unseen.map((ev) => redeliver(s.consumer, s.table, ev)));
      for (const r of results) {
        tally[r] = (tally[r] ?? 0) + 1;
        if (r === "ok" || r === "dispatched") redelivered++;
      }
      totalRedelivered += redelivered;
    }
    streams[s.table] = {
      unseen: unseen.length,
      redelivered,
      sample_ids: unseen.slice(0, 5).map((e) => e.event_id),
      ...(Object.keys(tally).length ? { outcome_tally: tally } : {}),
    };
  }

  return {
    dry_run: dryRun,
    age_minutes: ageMin,
    lookback_hours: lookbackHours,
    total_unseen: totalUnseen,
    total_redelivered: totalRedelivered,
    dead_letter_count: await deadLetterCount(),
    streams,
    swept_at: new Date().toISOString(),
  };
}
