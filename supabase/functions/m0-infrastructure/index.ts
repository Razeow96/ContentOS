// M0 · Infrastructure — deployable gate endpoint.
// Edge functions use the rate-limit library in-process (guardedFetch). n8n CANNOT
// import it, so callers outside Deno hit this endpoint instead — learnrules
// requires the gate for n8n too, not just adapters ("no direct raw calls from
// adapters or n8n"). Same SQL budgets, same ledger, one source of truth.
//
//   POST { action:"acquire", provider:"api.brightdata.com", method:"POST",
//          url:"https://...", estimated_records: 10 }
//     -> { allowed:true,  log_id, requests_left, records_left }
//     -> { allowed:false, reason, log_id }            // caller MUST NOT fire
//
//   POST { action:"report", log_id, status, duration_ms, records }
//     -> { ok:true }

import { acquire, report } from "./rate-limit/ratelimit.ts";
import { providerOf } from "./rate-limit/config.ts";
import { callerIp, logRun } from "./observability/runlog.ts";

interface Body {
  action?: "acquire" | "report" | "log";
  provider?: string;
  method?: string;
  url?: string;
  estimated_records?: number;
  log_id?: number;
  status?: number;
  duration_ms?: number;
  records?: number;
  // action:"log" — n8n reports one run_log row per workflow run (RAZ-58).
  source?: string;
  run_action?: string;
  run_status?: string;
  correlation_id?: string;
  summary?: unknown;
  error?: string;
  caller_ip?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    const text = await req.text();
    let body: Body;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch (e) {
      return json({ ok: false, error: `Body is not valid JSON: ${(e as Error).message}` }, 400);
    }

    if (body.action === "report") {
      if (typeof body.log_id !== "number") return json({ ok: false, error: "report needs log_id" }, 400);
      await report(body.log_id, body.status ?? 0, body.duration_ms ?? 0, body.records);
      return json({ ok: true });
    }

    // action:"log" — n8n workflows log their run here (edge fns use withRun in-process).
    // Invariant #8: every execution path logs. Best-effort — a logging failure is a 500
    // to the caller but never denies anything.
    if (body.action === "log") {
      if (!body.source) return json({ ok: false, error: "log needs source" }, 400);
      const log_id = await logRun({
        source: body.source,
        action: body.run_action ?? null,
        caller_ip: body.caller_ip ?? callerIp(req),
        correlation_id: body.correlation_id ?? null,
        status: body.run_status ?? "ok",
        summary: body.summary ?? null,
        error: body.error ?? null,
        duration_ms: body.duration_ms ?? null,
      });
      return json({ ok: true, log_id });
    }

    // default: acquire
    const url = body.url ?? "";
    const provider = body.provider ?? (url ? providerOf(url) : "");
    if (!provider) return json({ ok: false, error: "acquire needs provider or url" }, 400);

    const gate = await acquire(provider, (body.method ?? "POST").toUpperCase(), url, body.estimated_records ?? 0);
    // 200 either way: a denial is a valid answer, not a transport error. n8n
    // branches on allowed — an HTTP error would just look like a broken node.
    return json(gate);
  } catch (e) {
    // Fail-closed: if the gate itself is broken, the answer is NO.
    return json({ allowed: false, reason: `gate error: ${(e as Error).message}` }, 200);
  }
});
