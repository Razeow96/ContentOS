// m3-generate types (RAZ-49). Shapes must match the ContentGenerated v1 contract.

export interface SourceEventRecord {
  event_id: string;
  event_type: string;
  schema_version: number;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  payload: Record<string, unknown> & {
    page?: string;
    source?: string;
    material_type?: string;
    tier?: string;
    title?: string;
    summary?: string | null;
    url?: string | null;
    image_url?: string | null;
    media?: unknown[] | null;
    published_at?: string | null;
    entities?: Record<string, unknown> | null;
    enrichment?: Record<string, unknown> | null;
    ref_kind?: string;
    trend_signal_id?: string | null;   // RAZ-72: the originating trend (null off the trend path)
  };
  occurred_at: string;
}

export interface PillarRow {
  pillar_id: string;
  version: number;
  name: string;
  description: string | null;
  instruction_md: string;
  evidence_req: Record<string, unknown>;
  format_hints: Record<string, unknown>;
  char_range: [number, number];      // parsed from format_hints.char_range
  weight: number;
  cooldown_days: number;             // resolved: overrides ?? m3_config default
}

export interface CharacterCtx {
  name: string;
  display_name: string | null;
  gender: string | null;
  age: number | null;
  current_city: string | null;
  disc_picks: string[];
  slang_level: string;
  voice_tone_energy: string;
  background_story: string | null;
  skills: string[] | null;
  interests: string[] | null;
  mood: string;
  mood_note: string | null;
  bands: Record<string, string>;     // rendered band phrase per field (slang/tone/mood)
  lexicon_samples: { shortforms: string[]; localizers: string[]; badwords: string[] };
  lexicon_all: { shortforms: string[]; localizers: string[]; badwords: string[] }; // full sets — the validator checks presence against these, not the sampled 12
}

export interface GenConfig {
  model: string;
  max_tokens: number;
  daily_draft_cap: number;
  material_types: string[];
}

export interface Ctx {
  page: string;
  language: string;
  region: string;
  hard_rules: string;
  audience: string;
  visual: string;
  forbidden: string[];
  character: CharacterCtx;
  pillars: PillarRow[];
  recentOpeners: string[];
  // 14-day posted history — the dedup key set (RAZ-59). angle_entity is the
  // movie/person; movie_year makes the key deterministic across re-angling.
  burned: { pillar_id: string; entity: string; movie_year: number | null }[];
  dedupDays: number;
  minLexicon: number;                // resolved for this character's slang band
  draftsToday: number;
  gen: GenConfig;
}

export interface DraftJson {
  skip?: boolean;
  reason?: string;
  pillar_id?: string;
  entity?: string;
  movie_year?: number | null;        // release year of the work (null if the material has no film/drama)
  hook?: string;
  title?: string;
  copy?: string;
  hashtags?: string[];
  format_hint?: string;
  image_prompt?: string;
  language?: string;
}

export interface Validation {
  char_count: number;
  range_ok: boolean;
  pattern_ok: boolean;
  pattern_hits: string[];
  lexicon_count: number;   // distinct shortform+localizer tokens present in the copy
  lexicon_ok: boolean;     // lexicon_count >= minLexicon for the slang band
}
