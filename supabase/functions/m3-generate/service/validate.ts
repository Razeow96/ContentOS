// m3-generate · post-generation VALIDATOR (RAZ-49, extended RAZ-59). The fix for
// the owner findings: LLMs cannot self-enforce hard output constraints, so we
// enforce them in code after generation, not in the prompt:
//   (1) char_range — counted in code;
//   (2) forbidden_patterns (dashes) — scanned in code;
//   (3) word-DNA presence (RAZ-59) — the copy must actually USE at least the
//       slang band's minimum of the character's shortforms/localizers, else the
//       voice is injected in prose but ignored by the model. Counted in code.
// One auto-revise pass; still failing → flags on the draft, never a silent pass.

import type { DraftJson, Validation } from "./types.ts";

// Distinct shortform+localizer tokens that appear as a substring of the copy.
// (Badwords are register-gated, not part of the presence minimum.)
function countLexicon(copy: string, tokens: string[]): number {
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t && t.length > 0 && copy.includes(t)) seen.add(t);
  }
  return seen.size;
}

export function validateDraft(
  draft: DraftJson,
  range: [number, number],
  forbidden: string[],
  lexicon: { shortforms: string[]; localizers: string[] },
  minLexicon: number,
): Validation {
  const copy = String(draft.copy ?? "");
  const charCount = [...copy].length; // code points — counts Chinese correctly
  const hits = forbidden.filter((f) => f.length > 0 && copy.includes(f));
  const lexCount = countLexicon(copy, [...lexicon.shortforms, ...lexicon.localizers]);
  return {
    char_count: charCount,
    range_ok: charCount >= range[0] && charCount <= range[1],
    pattern_ok: hits.length === 0,
    pattern_hits: hits,
    lexicon_count: lexCount,
    lexicon_ok: lexCount >= minLexicon,
  };
}

export function buildReviseUser(
  draft: DraftJson,
  v: Validation,
  range: [number, number],
  minLexicon: number,
  lexiconSample: { shortforms: string[]; localizers: string[] },
): string {
  const problems: string[] = [];
  if (!v.range_ok) {
    problems.push(
      v.char_count < range[0]
        ? `copy is ${v.char_count} characters — EXTEND it to between ${range[0]} and ${range[1]} characters by deepening existing points (no new facts).`
        : `copy is ${v.char_count} characters — TRIM it to between ${range[0]} and ${range[1]} characters without losing the formula steps.`,
    );
  }
  if (!v.pattern_ok) {
    problems.push(
      `copy contains forbidden sequences ${v.pattern_hits.map((x) => JSON.stringify(x)).join(" ")} — remove EVERY occurrence; use 、 ， ： or a line break instead.`,
    );
  }
  if (!v.lexicon_ok) {
    problems.push(
      `copy uses only ${v.lexicon_count} of the character's spoken markers — weave in at least ${minLexicon} naturally (do NOT force them, rework phrasing so they fit). Short forms e.g. ${lexiconSample.shortforms.slice(0, 6).join(" ")} · particles e.g. ${lexiconSample.localizers.slice(0, 6).join(" ")}.`,
    );
  }
  return `Your previous draft violated hard constraints. Fix ONLY these problems and change nothing else about the content, voice, or structure:
- ${problems.join("\n- ")}

Previous draft JSON:
${JSON.stringify(draft)}

Return the corrected full JSON object (same schema, no fences, no prose).`;
}
