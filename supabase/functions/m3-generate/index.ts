// m3-generate Edge Function — entry point (RAZ-49).
// M3 Content Generation: consumes ONE SourceEnriched event (POSTed by the n8n
// consumer as { record: <source_events row> }), assembles the full generation
// context from SQL ONLY (page_identity + character brain + pillar catalog +
// ledger), calls Claude, VALIDATES the draft in code (char_range +
// forbidden_patterns — prose steers, the validator guarantees), then writes
// content_items and emits ContentGenerated to content_events.
//
// D12: everything needed arrives in the event payload + M3-owned config.
// No cross-domain reads. n8n holds zero logic (idempotency guard lives in the
// consumer workflow on gen_processed).

import { loadContext, buildPrompts } from "./service/context.ts";
import { callClaude, parseDraftJson } from "./service/claudeapi.ts";
import { validateDraft, buildReviseUser } from "./service/validate.ts";
import { writeContentItem, writeContentEvent } from "./service/writer.ts";
import type { SourceEventRecord, DraftJson } from "./service/types.ts";
import { withRun } from "../m0-infrastructure/observability/runlog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function handle(record: SourceEventRecord) {
  const p = record.payload ?? {};
  const page = String(p.page ?? "");
  if (!page) return { outcome: "skip", reason: "event has no page" };
  if (record.event_type !== "SourceEnriched") {
    return { outcome: "skip", reason: `not SourceEnriched: ${record.event_type}` };
  }
  // Contract Rule 3: inspiration tier never generates directly.
  if ((p.tier ?? "material") === "inspiration") {
    return { outcome: "skip", reason: "tier=inspiration (style/idea reference only)" };
  }

  const ctx = await loadContext(SUPABASE_URL, SERVICE_KEY, page);
  if (!ctx) return { outcome: "skip", reason: `page ${page} has no identity/character/pillars` };

  // Config gates: material types + daily draft cap (flood/cost control).
  const mt = String(p.material_type ?? "");
  if (!ctx.gen.material_types.includes(mt)) {
    return { outcome: "skip", reason: `material_type ${mt} not enabled for generation` };
  }
  if (ctx.draftsToday >= ctx.gen.daily_draft_cap) {
    return { outcome: "skip", reason: `daily_draft_cap ${ctx.gen.daily_draft_cap} reached` };
  }

  const { system, user } = buildPrompts(ctx, p);
  const raw = await callClaude(ctx.gen.model, ctx.gen.max_tokens, system, user);
  let draft = parseDraftJson(raw);
  if (!draft) return { outcome: "error", reason: "model response was not parseable JSON" };
  if (draft.skip) return { outcome: "skip", reason: `model skip: ${draft.reason ?? "no angle"}` };

  // Pillar must be one the page actually ticked.
  const pillar = ctx.pillars.find((x) => x.pillar_id === draft!.pillar_id);
  if (!pillar) return { outcome: "skip", reason: `model chose unsubscribed pillar ${draft.pillar_id}` };

  // Dedup (RAZ-59): key = pillar × title × year within the dedup window → skip.
  // Same movie under a DIFFERENT pillar is allowed by design. Entity is normalized
  // (strip a （year） suffix, trim, lowercase) so re-angled duplicates still match.
  const normEntity = (s: string) => s.replace(/（\s*\d{4}\s*）|\(\s*\d{4}\s*\)/g, "").trim().toLowerCase();
  const dEntity = normEntity(draft.entity ?? "");
  const dYear = draft.movie_year ?? null;
  if (dEntity) {
    const hit = ctx.burned.some((b) =>
      b.pillar_id === pillar.pillar_id && normEntity(b.entity) === dEntity && (b.movie_year ?? null) === dYear);
    if (hit) {
      return { outcome: "skip", reason: `dedup: ${draft.entity}${dYear ? `（${dYear}）` : ""} × ${pillar.pillar_id} within ${ctx.dedupDays}d` };
    }
  }

  // ── VALIDATOR (deterministic; one auto-revise pass, then flag — never silent) ──
  // char_range · forbidden dashes · word-DNA presence (RAZ-59).
  const lex = ctx.character.lexicon_all;
  let v = validateDraft(draft, pillar.char_range, ctx.forbidden, lex, ctx.minLexicon);
  let revised = false;
  if (!v.range_ok || !v.pattern_ok || !v.lexicon_ok) {
    const fixed = parseDraftJson(
      await callClaude(ctx.gen.model, ctx.gen.max_tokens, system,
        buildReviseUser(draft, v, pillar.char_range, ctx.minLexicon, ctx.character.lexicon_samples)),
    );
    if (fixed && !fixed.skip) {
      draft = { ...draft, ...fixed };
      revised = true;
      v = validateDraft(draft, pillar.char_range, ctx.forbidden, lex, ctx.minLexicon);
    }
  }
  const flags: string[] = [];
  if (!v.range_ok) flags.push("range_violation");
  if (!v.pattern_ok) flags.push("pattern_violation");
  if (!v.lexicon_ok) flags.push("lexicon_violation");

  const itemId = await writeContentItem(SUPABASE_URL, SERVICE_KEY, {
    page, pillar, draft: draft as Required<DraftJson>, event: record,
    validation: { ...v, revised, flags },
  });
  await writeContentEvent(SUPABASE_URL, SERVICE_KEY, {
    itemId, page, pillar, draft: draft as Required<DraftJson>, event: record, lang: ctx.language, region: ctx.region,
  });

  return {
    outcome: "draft",
    content_item_id: itemId,
    pillar: pillar.pillar_id,
    entity: draft.entity,
    chars: v.char_count,
    revised,
    flags,
  };
}

Deno.serve((req) =>
  withRun("m3-generate", req, async (rl) => {
    try {
      const text = await req.text();
      if (!text.trim()) return json({ ok: false, error: "empty body — POST { record: <source_events row> }" }, 400);
      let body: { record?: SourceEventRecord };
      try {
        body = JSON.parse(text);
      } catch (e) {
        return json({ ok: false, error: `body is not valid JSON: ${(e as Error).message}` }, 400);
      }
      if (!body.record?.event_id) return json({ ok: false, error: "missing record.event_id" }, 400);

      const result = await handle(body.record);
      rl.action = result.outcome;
      rl.summary = result;
      rl.correlation_id = (body.record.payload as { correlation_id?: string } | undefined)?.correlation_id ?? null;
      rl.status = result.outcome === "error" ? "error" : result.outcome === "draft" ? "ok" : "skip";
      return json({ ok: result.outcome !== "error", event_id: body.record.event_id, ...result },
        result.outcome === "error" ? 500 : 200);
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  })
);
