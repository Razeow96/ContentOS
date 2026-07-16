// M0 · rate-limit — guardedFetch, the ONLY way adapters call third-party APIs.
// (learnrules: fetch wrapper approval — acquire must allow, or the call does not fire.)
//
//   const { res, done } = await guardedFetch(url, init, { estimatedRecords: 20 });
//   const items = parse(await res.json());
//   await done(items.length);            // optional: reconcile actual records
//
// Scope: OUTBOUND third-party calls. Our own Supabase REST calls are exempt —
// the gate itself runs on them, so gating them would recurse.

import { providerOf } from "./config.ts";
import { acquire, report } from "./ratelimit.ts";

export interface GuardedResult {
  res: Response;
  logId: number;
  done: (records?: number) => Promise<void>;
}

export class RateLimitDenied extends Error {
  constructor(public provider: string, public reason: string) {
    super(`rate-limit denied for ${provider}: ${reason}`);
    this.name = "RateLimitDenied";
  }
}

export async function guardedFetch(
  url: string,
  init?: RequestInit,
  opts?: { estimatedRecords?: number; provider?: string },
): Promise<GuardedResult> {
  const provider = opts?.provider ?? providerOf(url);
  const method = (init?.method ?? "GET").toUpperCase();

  const gate = await acquire(provider, method, url, opts?.estimatedRecords ?? 0);
  if (!gate.allowed) throw new RateLimitDenied(provider, gate.reason ?? "denied");

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    await report(gate.log_id, 0, Date.now() - started);
    throw e;
  }
  await report(gate.log_id, res.status, Date.now() - started);

  return {
    res,
    logId: gate.log_id,
    done: (records?: number) => report(gate.log_id, res.status, Date.now() - started, records),
  };
}
