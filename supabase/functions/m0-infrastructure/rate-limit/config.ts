// M0 · rate-limit — config & helpers.
// Budgets themselves live in SQL (api_rate_limits) — config is data. This file
// only knows how to identify a provider and how to scrub a URL for the ledger.

export interface GateEnv {
  supabaseUrl: string;
  serviceKey: string;
}

export function gateEnv(): GateEnv {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("rate-limit: SUPABASE_URL / SERVICE_ROLE_KEY not set");
  return { supabaseUrl, serviceKey };
}

// Provider identity = URL hostname. No budget row for the hostname = DENIED,
// so configuring the row IS the approval step for any new API (learnrules).
export function providerOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

// Never let a credential reach the ledger: redact common key-shaped query params
// (M1's YouTube key rides in the query string) and cap length.
export function scrubUrl(url: string): string {
  return url
    .replace(/([?&](key|api_key|apikey|token|access_token|secret)=)[^&]+/gi, "$1REDACTED")
    .slice(0, 500);
}
