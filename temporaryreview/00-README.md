# RAZ-48 Review — Pillars + Jello Identity

**This folder is temporary.** Edit anything directly in VS Code. When you're done, tell Claude "approved" (or "approved with my edits") and the final state of these files becomes:

1. **Linear** — attached to RAZ-48 as the approval record
2. **SQL** — seed migration → `pillar_catalog` + `page_identity` + `page_pillar_subscriptions` (source of truth)
3. This folder gets deleted after seeding.

## What you're reviewing

| File | Becomes |
|---|---|
| `01-identity-jello.md` | `page_identity` row for jello — voice, language rules, palette |
| `02`–`08` pillar files | One `pillar_catalog` row each (version 1) |
| `09-subscriptions.md` | jello's `page_pillar_subscriptions` rows — weights + cooldowns |

## Rules baked into every pillar (so you don't have to re-check each file)

- **Niche-agnostic**: no movie-specific wording in instructions. "Title/work/entity in the page's domain." Movie flavor comes from the identity + evidence at generation time. A finance page can tick the same pillar.
- **Grounding**: every factual claim (names, dates, numbers, quotes) must come from the supplied evidence — model knowledge is for voice only. This is enforced in code (RAZ-49); pillars state what evidence they *require*.
- **No caged creativity**: examples inside instructions are marked illustrative — they are never templates. The instruction constrains the *shape of the thinking*, not the wording.
- **Rule 3 inheritance**: reference text never verbatim; reference media only inside transformative composition.

## Each pillar file structure

```
metadata:        pillar_id / name / description / format_hints / evidence_req
instruction_md:  the text that goes into the prompt at generation time (edit freely)
```
