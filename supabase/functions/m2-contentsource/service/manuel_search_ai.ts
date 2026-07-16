// AI-assisted match (RAZ-26/RAZ-37). Given a keyword and candidate materials,
// asks Claude which are genuinely relevant, ranked best-first, and returns that
// filtered/ordered subset. Defensive: any failure returns the input unchanged
// (never lose candidates because the AI step hiccuped).

import { guardedFetch } from "../../m0-infrastructure/rate-limit/index.ts";
import type { RawMaterial } from "./types.ts";

export async function aiMatch(
  keyword: string,
  materials: RawMaterial[],
  apiKey: string,
): Promise<RawMaterial[]> {
  if (materials.length === 0) return materials;

  const list = materials
    .map((m, i) => `${i}: ${m.title}${m.summary ? " — " + String(m.summary).slice(0, 160) : ""}`)
    .join("\n");
  const prompt =
    `A user searched for "${keyword}". Below are candidate results (index: title — summary). ` +
    `Return ONLY a JSON array of the indices that are genuinely relevant to the search, most relevant first. ` +
    `No prose, no code fences.\n\n${list}`;

  try {
    // Denial throws -> caught below -> materials returned unchanged: over-budget
    // means the AI-assist step is skipped, never that candidates are lost.
    const { res } = await guardedFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 10000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return materials;
    const j = await res.json();
    const text: string = j?.content?.[0]?.text ?? "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return materials;
    const idx = JSON.parse(match[0]);
    if (!Array.isArray(idx) || idx.length === 0) return materials;
    const picked = idx
      .filter((i) => Number.isInteger(i) && i >= 0 && i < materials.length)
      .map((i) => materials[i]);
    return picked.length ? picked : materials;
  } catch {
    return materials;
  }
}
