// M0 · rate-limit — acquire/report against the SQL gate.
// acquire() is FAIL-CLOSED: a denied budget, a missing provider row, or the gate
// itself being unreachable all mean the call must not fire (learnrules: fetch
// wrapper approval). The atomicity lives in the api_gate_acquire SQL function.

import { gateEnv, scrubUrl } from "./config.ts";

export interface Acquire {
  allowed: boolean;
  reason?: string;
  log_id: number;
  requests_left?: number | null;
  records_left?: number | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
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
  if (!res.ok) throw new Error(`rate-limit gate ${fn} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function acquire(
  provider: string,
  method: string,
  url: string,
  estimatedRecords = 0,
): Promise<Acquire> {
  return await rpc<Acquire>("api_gate_acquire", {
    p_provider: provider,
    p_method: method,
    p_url: scrubUrl(url),
    p_est_records: estimatedRecords,
  });
}

// Best-effort: closing the ledger must never break the caller's happy path.
export async function report(
  logId: number,
  status: number,
  durationMs: number,
  records?: number,
): Promise<void> {
  try {
    await rpc<void>("api_gate_report", {
      p_log_id: logId,
      p_status: status,
      p_duration_ms: durationMs,
      p_records: records ?? null,
    });
  } catch (e) {
    console.error(`rate-limit report(${logId}) failed:`, (e as Error).message);
  }
}
