// Shared types for the m2-contentsource Edge Function.
// The SourceEnriched shape here MUST match the Linear contract "SourceEnriched v1".

export type MaterialAdapterType = "api" | "rss" | "ingest" | "brightdata";
export type Tier = "material" | "inspiration";

// One source entry from sources.json (the material catalog)
export interface MaterialSource {
  name: string;
  type: MaterialAdapterType;
  enabled: boolean;
  material_type: string;             // movie | article | listing | dataset | reference_post
  kind: string | null;               // listing subtype: provider | now_showing | upcoming | ...
  tier: Tier;
  url: string;                       // template with {placeholders}; "" for ingest/brightdata sources
  auth_ref: string | null;           // name of the secret env var, or null
  auth_mode?: "query" | "bearer";    // how to attach the secret (default: query)
  auth_param?: string;               // query param name when auth_mode=query (default: "key")
  image_base?: string;               // prefix for relative image paths (e.g. TMDB poster_path)
  search?: boolean;                  // true = usable as a keyword-search source ({query} in url)
  // Bright Data (type="brightdata") only:
  dataset_id?: string;               // gd_... scraper id from the Bright Data dashboard
  platform?: string;                 // for bd_input="url": matches page_reference_sources.platform
  bd_input?: "prompt" | "url";       // "prompt" = AI scraper (keyword→answer); "url" = scrape ref pages
  bd_url?: string;                   // bd_input="prompt": the scraper's required chat-surface url
  bd_discover_by?: string;           // bd_input="url": discover mode (profile_url|url|...); omit = collect-by-URL
  bd_params?: Record<string, unknown>; // extra fields merged into each Bright Data input row
  defaults: Record<string, string | null>;
  response_items_path: string;       // dot-path to the array of items ("" = response is the array)
  field_map: Record<string, string | { const: string } | Record<string, string>>;
  notes?: string;
}

// One row from the page_material_sources table (per-page API-adapter subscription)
export interface MaterialSubscription {
  page_id: string;
  source: string;
  params: Record<string, string | null>;
  enabled: boolean;
}

// A resolved job: one source + one param-set, plus the pages that want it
export interface MaterialJob {
  source: MaterialSource;
  params: Record<string, string | null>;
  url: string;                       // placeholders filled, {auth} removed
  subscribers: MaterialSubscription[];
  trigger: { correlation_id: string; causation_id: string | null } | null;  // set when trend-driven
}

// A normalized raw material (before per-page fan-out)
export interface RawMaterial {
  raw_material_id: string;
  source: string;
  material_type: string;
  kind: string | null;
  tier: Tier;
  title: string;
  summary: string | null;
  entities: Record<string, unknown> | null;
  image_url: string | null;
  media: unknown[] | null;
  url: string | null;
  lang: string | null;
  region: string | null;
  country: string | null;
  topic_tags: string[] | null;
  published_at: string | null;
  engagement: Record<string, unknown> | null;
  enrichment: Record<string, unknown> | null;
  external_id: string | null;
  raw: unknown;
}

// The event payload written to source_events (one per matching page)
export interface SourceEnriched extends RawMaterial {
  page: string;
  event_type: "SourceEnriched";
  correlation_id: string;
  causation_id: string | null;
}
