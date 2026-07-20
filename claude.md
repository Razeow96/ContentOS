# Content OS — DDD & Architecture Principles

These are binding rules for how Content OS is built. They come from ADR-001 (Linear). If a request conflicts with these, follow the rule and say so.

## Start of EVERY session — read these first
Before answering anything or touching code, read **both**:
1. **`learnrules.md`** — working rules: SESSION.md discipline, Linear/tracking discipline, hard boundaries.
2. **`SESSION.md`** — current state of the build: what's live, what's open, what's pending on the owner.

Treat SESSION.md as a snapshot that may be stale — it is only rewritten when asked, so it can lag the real state by days. **Verify before relying on it**: check Linear for the live board, and check the live DB/deployment when a claim is load-bearing (e.g. "migration X is applied"). Say so when it's out of date rather than building on a stale premise.

## Core stance
Content OS is a **domain-driven, event-driven** system. 10 domains, each a bounded context. We are migrating OFF 3 legacy n8n workflows using the **strangler pattern** — carve out one domain at a time, never break what's live.

## The 10 domains
Trend Intelligence · Content Sources · Content Generation · Media Production · Publishing · Analytics · Learning · Page Management · Scheduling · Infrastructure.

## Non-negotiable invariants
1. **One aggregate = one domain = one append-only SQL stream table** (e.g. `trend_events`, `source_events`). One writer per stream.
2. **Domains communicate ONLY through events.** A domain NEVER reads or writes another domain's tables. If you need another domain's data, react to its event — don't query its tables.
3. **Push delivery, event-based.** A Supabase Database Webhook fires on INSERT into a stream table and POSTs to the subscriber. No polling/cursors. (Scope: BETWEEN domains. Polling a third-party vendor that can't push — e.g. Bright Data snapshot status — is normal, and lives ONLY in the n8n Harvest Worker, never in edge functions.)
4. **Fat, self-contained events.** The event payload carries everything a subscriber needs, so subscribers never call back into the source domain.
5. **Idempotent consumers.** Every subscriber dedups on `event_id` (a "seen log"), because delivery is at-least-once.
6. **Correlation & causation.** `correlation_id` is minted at the head of a flow and copied to every downstream event; `causation_id` = the event that caused this one. This is how a flow is traced across domains.
7. **Contract-first.** Every event type has a versioned contract (Linear doc) approved BEFORE its code is built. Additive change = bump schema_version; breaking change = new event_type (e.g. TrendDetectedV2).
8. **Every execution path logs — mandatory, current AND future.** Every feature — edge function, n8n workflow, consumer — MUST emit an invocation record to the M0 observability log (`run_log`, via the `withRun` helper / the gate `log` endpoint): source, caller IP, action, status, `correlation_id`, outcome. No silent execution paths. This is a **security control, not just debugging**: the run log + the rate-limit gate/ledger (`api_request_log`) are the only two surfaces we monitor and audit for what ran, from where, and what it spent. A feature that runs without logging is NOT Done. (Tracked: RAZ observability issue.)

## Logic placement
- **n8n is an orchestrator, not a logic engine.** Use it for scheduling, triggering, and status reporting only.
- **Real logic lives in real code** — Supabase Edge Functions (Deno/TS). If a workflow is becoming many code-nodes, that's a smell: move the logic into a function.
- **Config is data, not code.** Platform/catalog config lives in JSON files (edited in VS Code) or SQL tables — never hardcoded in logic. The code READS config; it doesn't CONTAIN it.
- **UI renders what the backend serves; it never re-implements backend logic.** No copied predicates, enums, or column lists in the frontend — a UI-side re-derivation (a guessed `bd_input` value) silently hid 4 platforms. If the backend classifies it, the UI reads that classification or reuses the exact same rule.

## Aggregate vs reactor
Not every domain owns state. An **aggregate** owns tables + enforces invariants (e.g. Trend owns dedup/freshness). A **reactor** is stateless: event-in → transform → event-out (e.g. Media Production). Decide which before building; getting it wrong creates a distributed monolith.

## Migration safety (strangler)
- Legacy workflows A (Chinese Movie Generator), B (Poster), C (Daily Report) STAY LIVE and untouched except explicit, logged patches.
- New domains run in **shadow mode** (emit real events alongside prod) before any cutover.
- Build **per feature, per day** — every feature independently shippable and reversible. No big-bang.
- `content_queue` becomes a projection fed by events; Workflow B becomes the Publishing domain.

## Definition of done (every feature)
Migration applied · events flowing · consumers idempotent · contract + docs updated · artifacts in the repo working tree (committing is Raze's, on his timeline — mark Done in Linear without waiting for it) · legacy A/B/C unaffected.

## Capturing a lesson (mandatory — added 2026-07-19)
When a mistake is made AND its fix is found AND that fix has been **proven by a real run**, do all three:
1. **Notify Raze** — state the mistake, the root cause, and the proof in one short block.
2. **Propose the learned rule** — one or two lines, written as a rule for the future, not a story about the past. Wait for his approval before writing it.
3. **On approval, append it** to the right scope:
   - Domain-specific → `supabase/functions/<domain>/CLAUDE.md` under `## Learned rules` (auto-loads when work touches that folder).
   - Global / cross-domain / working-style → `learnrules.md` at the repo root.
   - Unsure which → it is domain-specific unless it would have prevented the same bug in another domain.

Never append an unproven theory, and never log the same lesson in two places. Directory `CLAUDE.md` files carry invariants + learned rules only — deep knowledge stays in the domain `readme.md`.

## Volume / cross-source rule (learned)
Signals from different platforms are never merged and never volume-compared (views ≠ searches ≠ likes). Store raw {value, unit, source}; relative "hotness" is a later Analytics/Learning job.

# Working with Raze — Persona & Communication Rules

## Who Raze is
Founder and **system architect** of Content OS. Understands DDD, event-driven design, and infrastructure topology at a systems level. **Does NOT write code.** Communicates architecture and intent; relies on the AI to produce the actual code.

### When code is involved (SQL, JSON, TypeScript, n8n expressions, shell)
- **Always give a complete, ready-to-copy-paste block.** No fragments, no "add a line here."
- **Do NOT explain where to click or how to use the tools.** He knows n8n, Supabase, VS Code, SQL editors, Git. Skip all UI/navigation hand-holding.
- **DO give exact technical instructions when a sequence matters** — e.g. "edit file → `supabase functions deploy m1-trend` → invoke", or the precise order of SQL statements. He needs the *what and the order*, not the *where*.
- If a value must be filled in (page_id, key), mark it clearly (e.g. `YOUR_US_PAGE`) rather than guessing.

### When explaining
- Explain at **systems level** — the why, the tradeoff, the architecture impact. Not line-by-line code walkthroughs unless asked.
- Be concise. He moves fast and dislikes over-explanation.
- Surface real constraints and honest limitations plainly (e.g. "Google RSS can't filter by category"). Don't paper over them.
- after explanation provide direct solution or to do list. avoid hanging unknown should the user conduct any action or not.

## Build philosophy
- **Lean and fast, but proven.** Build fast — and a feature is accepted ONLY after its main path ran once for real with the result observed. That single proven run is what Done requires; never accept on "the logic is sound". No edge-case hunting beyond it; debug/maintain only when a real problem surfaces.
- Don't over-engineer. Smallest correct change. No speculative folders, abstractions, or features not asked for.
- if there is no action needed to be taken, no explanation needed.

### Go-live is the owner's, not yours (added 2026-07-17)
- **Activation · publishing · cutover · migration · commits are Raze's decisions on Raze's timeline.** They are NOT tasks, NOT blockers, and NOT "remaining work". State a go-live prerequisite **once**, in the Linear issue where it belongs — then never mention it again unless he asks
