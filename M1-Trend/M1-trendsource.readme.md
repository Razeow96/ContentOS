# M1 · TREND SOURCE — AI OPERATING BRIEF

> **READ THIS ENTIRE FILE BEFORE DOING ANYTHING.** You are an AI assistant with no memory of prior sessions. This file is your complete context for working on Content OS trend sources. Do not act on the user's request until you have read and understood every section below. If a request conflicts with the rules here, follow the rules and tell the user.

---

## 0. WHO YOU ARE HELPING & HOW TO BEHAVE

- The user (Raze) is a **system architect / founder, NOT a coder**. Never explain where to click or how to use VS Code / n8n / Supabase — they know. Explain architecture and decisions; give ready-to-paste code/JSON.
- Build philosophy: **lean and fast**. Do the smallest correct change. Do not over-engineer, do not add features not asked for, do not write elaborate tests.
- When you edit a file, hand back the full corrected file or the exact block, validated.
- **Never invent an endpoint or field and present it as verified.** If you are not sure a URL/field exists, say so and mark it `enabled: false` with a `CONFIRM_ENDPOINT` note. A silent wrong endpoint that returns plausible-but-wrong data is the worst outcome here.

---

## 1. WHAT THIS FOLDER IS

`content-os/trend/` holds the **trend source catalog** for the Content OS "Trend Intelligence" domain (milestone M1). The main file is **`sources.json`**. Editing it is how new trend platforms are added or changed — with NO workflow code for `api` and `rss` types.

The Trend Intelligence domain pulls "what's trending" from external platforms, normalizes each signal into a standard shape, and emits one `TrendDetected` event per interested page. This file only defines the **platforms**. It knows nothing about pages.

---

## 2. THE THREE-LAYER MODEL (never violate this separation)

| Layer | Lives in | Answers | You edit it when |
|-------|----------|---------|------------------|
| **Source catalog** | `trend/sources.json` (this folder) | "What platforms exist & how to read them" | Adding/changing a platform |
| **Page subscriptions** | Supabase table `page_trend_sources` | "Which page listens to which source + filters" | (User does this in Supabase, not here) |
| **Secrets** | n8n credential store | The actual API keys | Never in files |

**Rules that must never be broken:**
1. **`sources.json` NEVER contains page names.** No `"page": "mateo"`. Pages subscribe in Supabase. If the user asks you to put a page in sources.json, refuse and explain this separation.
2. **`sources.json` NEVER contains API keys/secrets.** The URL uses a `{auth}` placeholder; `auth_ref` names an n8n credential. If the user pastes a key, tell them to store it in n8n and reference it by name — do not write it into the file.
3. **One writer / clean boundaries.** This is a DDD system. Trend Intelligence only produces trend data; it never reads other domains' tables.

---

## 3. `sources.json` STRUCTURE

Top-level: an object with `sources` (array of source objects) plus keys starting with `_` (readme/help/examples) that the loader IGNORES. Keep the `_` help keys intact when editing.

### A source object

```json
{
  "name": "google_trends_daily",        // unique id. Include timeframe in the name if the platform has windows.
  "type": "rss",                         // "api" | "rss" | "scrape"
  "enabled": true,                       // false = staged/not pulled
  "timeframe": "daily",                  // now | daily | weekly | monthly | yearly
  "url": "https://.../rss?geo={region}", // template; {placeholders} filled per-pull from the page subscription
  "auth_ref": null,                      // name of an n8n credential, or null. NEVER the key itself.
  "defaults": { "region": "TW", "country": "Taiwan", "language": "zh", "category": null },
  "signal_type": "search_trend",         // free label describing the signal
  "response_items_path": "rss.channel.item", // dot-path to the ARRAY of items in the response ("" if the response is already an array)
  "field_map": { ... },                  // see section 5
  "notes": "human note; say WORKING or SCAFFOLD/disabled and why"
}
```

### Placeholders allowed in `url`
`{region}` `{language}` `{country}` `{category}` `{chart}` `{max}` `{auth}` — filled at pull time from the page subscription (or the source `defaults`). `{auth}` is replaced with the secret from the n8n credential named in `auth_ref`.

---

## 4. THE TWO DECISIONS: new placeholder vs new source

When the user wants to add a platform or a variation, decide:

- **Same endpoint + same response shape, only different values** (e.g. YouTube TW vs US, 25 vs 50 results) → this is NOT a new source. It is handled by a **page subscription** in Supabase. You usually don't touch sources.json at all.
- **Different endpoint OR different response shape OR different timeframe window** → a **new source object** with its own `name`, `url`, `field_map`, and `timeframe`.

Rule of thumb: *same shape, different values = subscription. Different shape or window = new source entry.*

**Timeframe specifically:** the user's convention is SEPARATE named sources per window (`google_trends_daily`, `_weekly`, `_monthly`), NOT a `{timeframe}` placeholder. A platform only gets entries for windows it actually supports. If a platform is "now only" (e.g. YouTube mostPopular), it has ONE entry, timeframe `now`, no siblings.

---

## 5. `field_map` — the most important part

`field_map` translates a platform's response into the standard TrendDetected fields. **Keys are OUR standard field names; values are the dot-path into ONE item of the platform's response.**

### Target fields (the ONLY valid keys)
`topic` (REQUIRED), `description`, `category`, `keywords`, `region`, `country`, `language`, `volume_value`, `volume_unit`, `rank`, `image_url`, `related`, `external_id`, `url`, `detected_at`.

- Paths use dot notation into an item: `"snippet.title"`, `"statistics.viewCount"`, `"media.0.url"` (index into arrays with a number).
- For RSS, an item is one `<item>`; namespaced tags use the `ht:` form, e.g. `"ht:approx_traffic"`.
- A **literal constant** (not a path) is written `{ "const": "searches" }` — used mainly for `volume_unit`.
- **Volume is always `{volume_value, volume_unit}`** and is NEVER comparable across platforms (YouTube views ≠ Google searches ≠ Dcard likes). Just capture value + unit; ranking across platforms is a later Analytics job. Do not try to normalize volumes.
- Omit any field the platform doesn't provide. `topic` must always be mappable.

---

## 6. HOW TO RESEARCH A PLATFORM (when user asks "what data does X support?")

When the user asks you to source/investigate a new platform, produce a short report answering:
1. **Does it have an API, an RSS feed, or neither (scrape)?** → sets `type`.
2. **What timeframes does it expose?** (now / daily / weekly / monthly / yearly) → one source entry per supported window.
3. **What auth does it need?** (none / API key / OAuth) → `auth_ref` or null. Never write the key.
4. **What is the response shape?** Where is the array of items (`response_items_path`), and what path holds topic / volume / image / etc. → the `field_map`.
5. **Rate limits / gotchas** worth noting.

Then draft the source object(s). **Mark anything you could not verify as `enabled: false` with a `CONFIRM_ENDPOINT` note.** Do not guess a working URL.

---

## 7. VALIDATION BEFORE YOU FINISH

- The file must be valid JSON (no trailing commas, matched braces). State that you validated it.
- Every source has: unique `name`, valid `type`, `timeframe`, `url`, `field_map` with a `topic`, and `enabled` set intentionally.
- No page names anywhere. No secrets anywhere.
- If you added a source that needs a key, remind the user to create the n8n credential named in `auth_ref`.
- If you added/changed a real endpoint, remind the user this is shadow/config only — it does not affect the live legacy workflows.

---

## 8. WHAT YOU MUST NOT DO

- Do NOT put page names or secrets in sources.json.
- Do NOT invent endpoints/fields and present them as confirmed.
- Do NOT add a `{timeframe}` placeholder — use separate named sources per window.
- Do NOT normalize/compare volume across platforms.
- Do NOT modify the live legacy n8n workflows (Chinese Movie Generator / Poster / Daily Report) — this folder is config for the new Trend domain only.
- Do NOT refactor or "improve" beyond the specific request. Lean and fast.

---

## 9. QUICK REFERENCE — a minimal correct source

```json
{
  "name": "example_daily",
  "type": "rss",
  "enabled": true,
  "timeframe": "daily",
  "url": "https://example.com/trending.rss?geo={region}",
  "auth_ref": null,
  "defaults": { "region": "TW", "country": "Taiwan", "language": "zh", "category": null },
  "signal_type": "search_trend",
  "response_items_path": "rss.channel.item",
  "field_map": {
    "topic": "title",
    "url": "link",
    "detected_at": "pubDate"
  },
  "notes": "WORKING. One-line what/why."
}
```

**End of brief. Now read the user's request and proceed within these rules.**
