// m3-generate · Claude API adapter (RAZ-49). Through guardedFetch — the
// api.anthropic.com budget row is the approval; the ledger is the audit trail.
// Model + max_tokens come from m3_config (RAZ-55 lesson: never hardcoded).

import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { DraftJson } from "./types.ts";

export async function callClaude(
  model: string,
  maxTokens: number,
  system: string,
  user: string,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const { res, done } = await guardedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  }, { estimatedRecords: 1 });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json() as { content?: { type: string; text?: string }[] };
  await done(1);
  return j.content?.find((c) => c.type === "text")?.text ?? "";
}

// Robust JSON extraction: models sometimes wrap JSON in fences or stray prose.
export function parseDraftJson(text: string): DraftJson | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const candidates = [cleaned];
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) candidates.push(m[0]);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object") return obj as DraftJson;
    } catch { /* try next */ }
  }
  return null;
}
