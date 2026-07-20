// Shared types for the m1-trend Edge Function.
// The TrendDetected shape here MUST match the Linear contract "TrendDetected v1".
 
export type AdapterType = "rss" | "api" | "scrape";
 
// One source entry from trend/trendsource.json
export interface Source {
  name: string;
  type: AdapterType;
  enabled: boolean;
  timeframe: string | null;      // now | daily | weekly | monthly | yearly
  url: string;                   // template with {placeholders}
  auth_ref: string | null;       // name of the secret env var, or null
  defaults: Record<string, string | null>;
  signal_type: string | null;
  response_items_path: string;   // dot-path to the array of items ("" = response is the array)
  field_map: Record<string, string | { const: string }>;
  notes?: string;
}
 
// One subscription row from the page_trend_sources table
export interface Subscription {
  page_id: string;
  source_name: string;
  region: string | null;
  language: string | null;
  country: string | null;
  category: string | null;
  keywords: string[] | null;
  chart: string | null;
  max_results: number | null;
  campaign: string | null;       // operator grouping label (admin); stamped onto the event
}
 
// A resolved pull job: one source + one param-set, plus the pages that want it
export interface PullJob {
  source: Source;
  region: string | null;
  language: string | null;
  country: string | null;
  chart: string | null;
  max: string | null;
  url: string;                   // placeholders filled, {auth} removed
  subscribers: Subscription[];
}
 
// A normalized raw trend (before per-page fan-out)
export interface RawTrend {
  raw_trend_id: string;
  source: string;
  adapter_type: AdapterType;
  timeframe: string | null;
  topic: string;
  description: string | null;
  category: string | null;
  keywords: string[] | null;
  volume: { value: unknown; unit: string | null; source: string } | null;
  rank: number | null;
  signal_type: string | null;
  image_url: string | null;
  related: unknown;
  external_id: string | null;
  url: string | null;
  region: string | null;
  country: string | null;
  language: string | null;
  detected_at: string;
  raw: unknown;
}
 
// The event payload written to trend_events (one per matching page)
export interface TrendDetected extends Omit<RawTrend, never> {
  page: string;
  campaign: string | null;       // schema_version 2: the subscription's campaign label (null = ungrouped)
  event_type: "TrendDetected";
  correlation_id: string;
}