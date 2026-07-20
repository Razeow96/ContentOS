// M0 · observability — run_log invocation logging (RAZ-58).
// Every edge function wraps its Deno.serve handler in withRun(): ONE row per
// invocation (source, caller IP, action, status, correlation_id, summary), so
// "what ran, from where, and did it finish" is auditable — the security/monitor
// surface paired with the rate-limit ledger (CLAUDE.md invariant #8).
//
// Logging is BEST-EFFORT: it must never block, break, or change the outcome of
// the function it observes. Every DB call is wrapped so a logging failure only
// prints, never throws into the handler.

import { gateEnv } from "../rate-limit/config.ts";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { supabaseUrl, serviceKey } = gateEnv();
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`run_log ${fn} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// First non-empty x-forwarded-for hop = the original caller (proxies append).
// Falls back across proxy variants; never throws.
export function callerIp(req: Request): string | null {
  try {
    const xff = req.headers.get("x-forwarded-for");
    if (xff && xff.trim()) return xff.split(",")[0].trim();
    return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
  } catch {
    return null;
  }
}

// The handler enriches this as it learns the outcome. All fields optional:
// withRun infers status from the HTTP response when the handler doesn't set it.
export interface RunCtx {
  action?: string;
  correlation_id?: string | null;
  status?: "ok" | "skip" | "error";
  summary?: unknown;
}

export async function withRun(
  source: string,
  req: Request,
  handler: (rl: RunCtx) => Promise<Response>,
): Promise<Response> {
  const ip = callerIp(req);
  let id: number | null = null;
  try {
    id = await rpc<number>("run_log_open", { p_source: source, p_caller_ip: ip });
  } catch (e) {
    console.error("run_log_open failed:", (e as Error).message);
  }

  const rl: RunCtx = {};
  try {
    const res = await handler(rl);
    const status = rl.status ?? (res.status < 400 ? "ok" : "error");
    if (id !== null) await close(id, rl, status, null);
    return res;
  } catch (e) {
    // Backstop for an unexpected throw: log it, and preserve the previous
    // 500-with-JSON-body behaviour rather than an empty isolate crash.
    if (id !== null) await close(id, rl, "error", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function close(id: number, rl: RunCtx, status: string, error: string | null): Promise<void> {
  try {
    await rpc<void>("run_log_close", {
      p_id: id,
      p_action: rl.action ?? null,
      p_correlation_id: rl.correlation_id ?? null,
      p_status: status,
      p_summary: rl.summary ?? null,
      p_error: error,
    });
  } catch (e) {
    console.error(`run_log_close(${id}) failed:`, (e as Error).message);
  }
}

// One-shot logger for callers that report after the fact (n8n via the gate
// endpoint). Throws on failure — the endpoint decides how to answer.
export async function logRun(p: {
  source: string;
  action?: string | null;
  caller_ip?: string | null;
  correlation_id?: string | null;
  status?: string | null;
  summary?: unknown;
  error?: string | null;
  duration_ms?: number | null;
}): Promise<number | null> {
  return await rpc<number>("run_log_log", {
    p_source: p.source,
    p_action: p.action ?? null,
    p_caller_ip: p.caller_ip ?? null,
    p_correlation_id: p.correlation_id ?? null,
    p_status: p.status ?? "ok",
    p_summary: p.summary ?? null,
    p_error: p.error ?? null,
    p_duration_ms: p.duration_ms ?? null,
  });
}
