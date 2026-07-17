// Shared types for the m2-contentsource Edge Function.
// The SourceEnriched shape here MUST match the Linear contract "SourceEnriched v1".

// "scrape" = Bright Data Web Unlocker (POST /request) for a single article page — a direct
// fetch, NOT the datasets API, so it is sync and needs no n8n orchestration.
export type MaterialAdapterType = "api" | "rss" | "ingest" | "brightdata" | "scrape";
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
  bd_input?: "prompt" | "url" | "keyword"; // "prompt" = AI scraper (keyword→answer); "url" = scrape ref pages; "keyword" = keyword discovery
  bd_url?: string;                   // bd_input="prompt": the scraper's required chat-surface url
  bd_discover_by?: string;           // discover mode (profile_url|url|search_filters|...); omit = collect-by-URL
  bd_params?: Record<string, unknown>; // extra fields merged into each Bright Data input row
  bd_search_cap?: number;            // bd_input="keyword": limit_per_input on the discover phase.
                                     // Keyword discovery declares no reliable count input, so this is the ONLY cap.
  // bd_input="keyword": the platform's own name for "the search term" — it is NOT the same
  // everywhere (probe-confirmed 2026-07-17: youtube keyword_search · tiktok search_keyword ·
  // reddit/pinterest keyword), and BD rejects unknown fields, so this must be data.
  bd_keyword_field?: string;
  // bd_input="keyword": the platform's field for a result-type filter, if it has one
  // (youtube "type" = Video|Shorts). Absent = the source has no such concept and the
  // caller's video_type is ignored rather than injected as a field BD will reject.
  bd_video_type_field?: string;
  // Sort is per-SOURCE config but strategy is per-REF, so a static bd_params sort would rank
  // best_performing refs against the wrong ordering (a reddit ref sorted "New" has ~0 upvotes
  // to rank BY). These two make the strategy→sort mapping DATA: the param name differs per
  // platform (reddit sort_by, youtube order_by) and so do the values, so neither may be
  // hardcoded in config.ts. Omit both = source has no sort concept.
  bd_sort_param?: string;                        // e.g. "sort_by" | "order_by"
  bd_sort_by_strategy?: Record<string, string>;  // e.g. { latest_n: "New", best_performing: "Top" }
  bd_zone?: string;                  // type="scrape": the Web Unlocker zone (GET /zone/get_active_zones)
  defaults: Record<string, string | null>;
  response_items_path: string;       // dot-path to the array of items ("" = response is the array)
  // A value is: a dot-path ("post_text") · a FALLBACK CHAIN of paths, first non-empty wins
  // (["images.0","video_thumbnail"]) · a literal ({const}) · or a composite object
  // ({likes:"num_likes", comments:"num_comments"}).
  field_map: Record<string, string | string[] | { const: string } | Record<string, string>>;
  notes?: string;
}

// One row from page_reference_sources (a reference page to harvest) — RAZ-36.
export interface RefRow {
  id: number;
  page_id: string;
  platform: string;
  ref_url: string;
  strategy: "latest_n" | "best_performing";
  window_days: number | null;
  cap: number | null;
  enabled: boolean;
  harvest_schedule: "daily" | "on_demand";
}

// One unit of work handed to n8n by harvest_plan mode. Self-contained on purpose:
// n8n orchestrates the slow async I/O and holds NO config of its own (ADR-001).
export interface HarvestJob {
  ref_id: number;
  page_id: string;
  platform: string;
  source: string;              // catalog entry that resolved this (e.g. bd_facebook)
  ingest_source: string;       // what to POST back as mode=ingest source
  dataset_id: string;
  discover_by: string | null;  // null = collect-by-URL (Facebook only)
  trigger_url: string;         // ready-to-call Bright Data URL, query params included
  inputs: Record<string, unknown>[];
  strategy: string;
  window_days: number | null;
  cap: number | null;
  strategy_supported: boolean; // false = scrapes, but ranking not implemented yet
}

// One unit of work handed to n8n by search_plan mode. Same contract as HarvestJob (the
// Harvest Worker reads trigger_url/inputs/ingest_source/cap and holds no config of its own),
// but keyword-shaped instead of ref-shaped: there is no page to harvest, so no ref_id/page_id.
// sink+keyword ride along so the worker's ingest callback lands the results in the right
// store without n8n knowing what a sink is.
export interface SearchJob {
  source: string;              // catalog entry that resolved this (e.g. bd_youtube_search)
  ingest_source: string;       // what to POST back as mode=ingest source
  platform: string | null;
  dataset_id: string;
  discover_by: string | null;
  trigger_url: string;         // ready-to-call Bright Data /trigger URL, query params included
  inputs: Record<string, unknown>[];
  cap: number;
  keyword: string;
  sink: "events" | "manual";
  ai_assist: boolean;
}

// One row from page_article_sources (RAZ-25) — an article feed/site per page.
// mode="rss": the site publishes a feed, parsed in-function (free, structured).
// mode="scrape": no feed — needs the async web-extractor path, not built yet.
export interface ArticleRow {
  id: number;
  page_id: string;
  mode: "rss" | "scrape";
  url: string;
  enabled: boolean;
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
