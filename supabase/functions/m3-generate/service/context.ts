// m3-generate context assembly (RAZ-49). Everything from SQL — zero file reads.
// Layers: page_identity (rules/audience/visual) · character brain (profile +
// latest state + renderer bands + lexicon samples) · pillar catalog (subscribed,
// versioned, char_range) · ledger (recent openers + recent angles + cooldowns).

import type { Ctx, CharacterCtx, PillarRow, GenConfig, SourceEventRecord } from "./types.ts";

function h(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function get<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url, { headers: h(key) });
  if (!res.ok) throw new Error(`context fetch ${res.status}: ${url.split("/rest/v1/")[1]?.split("?")[0]}`);
  return (await res.json()) as T;
}

function parseRange(fh: Record<string, unknown>): [number, number] {
  const m = String(fh.char_range ?? "").match(/(\d+)\s*-\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 100000];
}

function sample<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function loadContext(base: string, key: string, page: string): Promise<Ctx | null> {
  const today = new Date().toISOString().slice(0, 10);

  const [identityRows, subRows, charSubs, genRows, cdRows, gateRows] = await Promise.all([
    get<Record<string, unknown>[]>(`${base}/rest/v1/page_identity?page_id=eq.${page}`, key),
    get<Record<string, unknown>[]>(
      `${base}/rest/v1/page_pillar_subscriptions?page_id=eq.${page}&enabled=eq.true&select=*`, key),
    get<{ char_key: string }[]>(
      `${base}/rest/v1/page_character_subscriptions?page_id=eq.${page}&active=eq.true&select=char_key`, key),
    get<{ value: GenConfig }[]>(`${base}/rest/v1/m3_config?key=eq.generation&select=value`, key),
    get<{ value: number }[]>(`${base}/rest/v1/m3_config?key=eq.cooldown_days_default&select=value`, key),
    get<{ value: { dedup_days?: number; min_lexicon?: Record<string, number> } }[]>(
      `${base}/rest/v1/m3_config?key=eq.gate&select=value`, key),
  ]);
  const identity = identityRows[0];
  const charKey = charSubs[0]?.char_key;
  if (!identity || !charKey || subRows.length === 0 || !genRows[0]) return null;
  const cdDefault = Number(cdRows[0]?.value ?? 14);
  const gate = gateRows[0]?.value ?? {};
  const dedupDays = Number(gate.dedup_days ?? 14);
  const minLexiconMap = gate.min_lexicon ?? { none: 0, low: 1, medium: 2, high: 3, extreme: 4 };
  const sinceDedup = new Date(Date.now() - dedupDays * 86_400_000).toISOString();

  const pillarIds = subRows.map((s) => `"${s.pillar_id}"`).join(",");
  const [pillarRows, charRows, stateRows, bandRows, lexRows, recentRows, countRows] = await Promise.all([
    get<Record<string, unknown>[]>(
      `${base}/rest/v1/pillar_catalog?pillar_id=in.(${pillarIds})&enabled=eq.true&select=*&order=version.desc`, key),
    get<Record<string, unknown>[]>(
      `${base}/rest/v1/characters?char_key=eq.${charKey}&enabled=eq.true&select=*&order=version.desc&limit=1`, key),
    get<Record<string, unknown>[]>(
      `${base}/rest/v1/char_current_state?char_key=eq.${charKey}&select=mood,note&order=created_at.desc&limit=1`, key),
    get<{ field: string; renderer_bands: Record<string, string> | null }[]>(
      `${base}/rest/v1/char_field_catalog?renderer_bands=not.is.null&select=field,renderer_bands`, key),
    get<{ kind: string; token: string }[]>(`${base}/rest/v1/char_lexicons?select=kind,token`, key),
    get<{ pillar_id: string; angle_entity: string; movie_year: number | null; draft: { copy?: string } }[]>(
      `${base}/rest/v1/content_items?page_id=eq.${page}&created_at=gte.${sinceDedup}` +
      `&select=pillar_id,angle_entity,movie_year,draft&order=created_at.desc&limit=500`, key),
    get<{ count: number }[]>(
      `${base}/rest/v1/content_items?page_id=eq.${page}&created_at=gte.${today}&select=count`, key),
  ]);

  const chr = charRows[0];
  if (!chr) return null;
  const mood = String(stateRows[0]?.mood ?? "medium");
  const bands: Record<string, string> = {};
  for (const b of bandRows) {
    const v = b.field === "slang_level" ? String(chr.slang_level)
      : b.field === "voice_tone_energy" ? String(chr.voice_tone_energy)
      : b.field === "current_mood" ? mood : null;
    if (v && b.renderer_bands?.[v]) bands[b.field] = b.renderer_bands[v];
  }

  const slang = String(chr.slang_level);
  const allowBad = slang === "medium" || slang === "high" || slang === "extreme";
  const byKind = (k: string) => lexRows.filter((l) => l.kind === k).map((l) => l.token);
  const lexicon_all = {
    shortforms: byKind("shortform"),
    localizers: byKind("localizer"),
    badwords: byKind("mild_badword"),
  };
  const lexicon_samples = {
    shortforms: slang === "none" ? [] : sample(lexicon_all.shortforms, 12),
    localizers: slang === "none" ? [] : sample(lexicon_all.localizers, 12),
    badwords: allowBad ? sample(lexicon_all.badwords, 8) : [],
  };
  const minLexicon = slang === "none" ? 0 : Number(minLexiconMap[slang] ?? 2);

  const character: CharacterCtx = {
    name: String(chr.name), display_name: chr.display_name as string | null,
    gender: chr.gender as string | null, age: chr.age as number | null,
    current_city: chr.current_city as string | null,
    disc_picks: (chr.disc_picks as string[]) ?? [],
    slang_level: slang, voice_tone_energy: String(chr.voice_tone_energy),
    background_story: chr.background_story as string | null,
    skills: chr.skills as string[] | null, interests: chr.interests as string[] | null,
    mood, mood_note: (stateRows[0]?.note as string | null) ?? null,
    bands, lexicon_samples, lexicon_all,
  };

  // Latest enabled version per pillar (honor pinned_version when set).
  const pillars: PillarRow[] = [];
  for (const s of subRows) {
    const versions = pillarRows.filter((p) => p.pillar_id === s.pillar_id);
    const pick = s.pinned_version
      ? versions.find((p) => p.version === s.pinned_version)
      : versions[0]; // order=version.desc → newest first
    if (!pick) continue;
    const fh = (pick.format_hints as Record<string, unknown>) ?? {};
    const ov = (s.overrides as Record<string, unknown>) ?? {};
    pillars.push({
      pillar_id: String(pick.pillar_id), version: Number(pick.version),
      name: String(pick.name), description: pick.description as string | null,
      instruction_md: String(pick.instruction_md),
      evidence_req: (pick.evidence_req as Record<string, unknown>) ?? {},
      format_hints: fh, char_range: parseRange(fh),
      weight: Number(s.weight ?? 1),
      cooldown_days: typeof ov.cooldown_days === "number" ? ov.cooldown_days : cdDefault,
    });
  }
  if (pillars.length === 0) return null;

  // Openers from the most recent handful (variety steer); the full 14-day set
  // (burned) is the dedup key store (RAZ-59).
  const recentOpeners = recentRows
    .slice(0, 8)
    .map((r) => String(r.draft?.copy ?? "").slice(0, 14)).filter((s) => s.length > 0);
  const burned = recentRows.map((r) => ({
    pillar_id: r.pillar_id,
    entity: r.angle_entity ?? "",
    movie_year: r.movie_year ?? null,
  }));

  return {
    page, language: String(identity.language), region: String(identity.region),
    hard_rules: String(identity.hard_rules_md), audience: String(identity.audience_md),
    visual: String(identity.visual_md),
    forbidden: (identity.forbidden_patterns as string[]) ?? [],
    character, pillars, recentOpeners, burned, dedupDays, minLexicon,
    draftsToday: Number(countRows[0]?.count ?? 0),
    gen: genRows[0].value,
  };
}

export function buildPrompts(ctx: Ctx, payload: SourceEventRecord["payload"]) {
  const c = ctx.character;
  const never =
    `NEVER-RULES (absolute, override everything else):\n${ctx.hard_rules}\n` +
    (ctx.forbidden.length
      ? `FORBIDDEN character sequences in the copy (use 、 ， ： or a line break instead): ${ctx.forbidden.map((f) => JSON.stringify(f)).join(" ")}\n`
      : "");

  const pillarBlock = ctx.pillars.map((p) =>
    `### pillar_id: ${p.pillar_id} (${p.name}) — copy length MUST be ${p.char_range[0]}-${p.char_range[1]} Chinese characters\n${p.instruction_md}`
  ).join("\n\n");

  const system = `${never}
You write Facebook posts as this person (never as a page admin, never as an AI):
Name: ${c.name}${c.display_name ? ` (${c.display_name})` : ""} · ${c.gender ?? ""} · ${c.age ?? "?"} · lives in ${c.current_city ?? "?"}
Personality traits: ${c.disc_picks.join(", ")}
Voice energy: ${c.bands.voice_tone_energy ?? c.voice_tone_energy}
Slang: ${c.bands.slang_level ?? c.slang_level}
  Available short forms (use only where natural): ${c.lexicon_samples.shortforms.join(" ")}
  Available softeners/fillers: ${c.lexicon_samples.localizers.join(" ")}${c.lexicon_samples.badwords.length ? `\n  Mild attitude words (only if register fits): ${c.lexicon_samples.badwords.join(" ")}` : ""}
Today's mood: ${c.bands.current_mood ?? c.mood}${c.mood_note ? ` (${c.mood_note})` : ""}
Life canon (NEVER invent new life facts beyond this): ${c.background_story ?? ""}
Skills: ${(c.skills ?? []).join("、")} · Interests: ${(c.interests ?? []).join("、")}

Audience: ${ctx.audience}

## Subscribed pillars — choose the ONE that genuinely fits the material, or skip
${pillarBlock}

## Ledger (variety + dedup — RAZ-59)
Do NOT open the copy with any of these recent openings: ${ctx.recentOpeners.map((o) => JSON.stringify(o)).join(" ") || "(none yet)"}
RECENTLY COVERED in the last ${ctx.dedupDays} days — do NOT repeat the same pillar × title × year. A DIFFERENT pillar on the same title is encouraged (e.g. burning_now today, aftertaste tomorrow):
${ctx.burned.map((b) => `- ${b.pillar_id} × ${b.entity}${b.movie_year ? `（${b.movie_year}）` : ""}`).join("\n") || "(nothing yet)"}

## Grounding (absolute)
Every fact (names, dates, numbers, quotes, availability) must come from the MATERIAL below. Model knowledge may supply voice and general film literacy, never facts.

## Output — strict JSON only, no code fences, no prose around it
Either {"skip":true,"reason":"<why this material earns no post>"}
or {
  "pillar_id":"<one of the subscribed ids>",
  "entity":"<the primary work's title WITHOUT the year (e.g. 奧德賽); or the person/topic if the material has no film/drama>",
  "movie_year":<the work's release year as an integer (e.g. 2026); null if the material has no film/drama>,
  "hook":"<one-line angle summary>",
  "title":"<internal title>",
  "copy":"<the post text, in ${ctx.language}, length within the chosen pillar's range>",
  "hashtags":["#…"],
  "format_hint":"text|image|carousel|reel",
  "image_prompt":"<optional visual suggestion matching: ${ctx.visual.slice(0, 120)}…>",
  "language":"${ctx.language}"
}

${never}`;

  const user = `MATERIAL (SourceEnriched payload — the only source of facts):
${JSON.stringify({
    source: payload.source, material_type: payload.material_type,
    title: payload.title, summary: payload.summary, url: payload.url,
    image_url: payload.image_url, media: payload.media,
    published_at: payload.published_at, entities: payload.entities,
    enrichment: payload.enrichment,
  }, null, 2)}

Decide: does this material earn a post from one of the subscribed pillars? If yes, write it fully per that pillar's instruction, principle formula, and character range. If no, skip with a reason.`;

  return { system, user };
}
