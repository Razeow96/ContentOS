# Content OS — SQL structure (M0 event backbone)

> Reference for the database schema behind the Content OS event backbone.
> Maintained by hand because tooling may not have live DB access — **keep this in sync whenever SQL changes.**
> Stack: Supabase (Postgres). Delivery: Supabase Database Webhooks (`pg_net`) → n8n webhook triggers.
> Last updated: 2026-07-10 · Covers milestone **M0** (RAZ-6 → RAZ-11).

---

## 1. Architecture in one paragraph

Every domain owns exactly one **append-only event stream table** (`{domain}_events`) that only it writes to (ADR-001 §A1/§D12). When a row is inserted, a Supabase Database Webhook pushes the full row to the subscribing n8n workflow (§A2). Events are **fat / self-contained** — the `payload` carries everything a subscriber needs, so subscribers never query another domain's tables (§A3). Subscribers dedupe on `event_id` (idempotency) instead of using read cursors (§C9). An hourly safety sweep re-delivers anything that was never marked "seen," and failures land in `dead_letter`.

During M0 the whole pattern is proven on a throwaway `demo_events` stream. Real domain streams (`trend_events`, `source_events`, …) get created from the same template starting in M1.

---

## 2. The event envelope (template — every stream is identical)

Every `{domain}_events` table has this exact shape. Only the table name changes.

```sql
create table if not exists {{domain}}_events (
    event_id        uuid         primary key default gen_random_uuid(),
    event_type      text         not null,            -- PascalCase, e.g. 'TrendDetected'
    schema_version  int          not null default 1,  -- bump on additive payload change
    aggregate_id    text         not null,            -- id of the aggregate instance
    correlation_id  uuid         not null,            -- one content flow, end to end
    causation_id    uuid,                             -- event_id that directly caused this
    payload         jsonb        not null,            -- fat / self-contained
    occurred_at     timestamptz  not null default now()
);
create index if not exists {{domain}}_events_occurred_at_idx  on {{domain}}_events (occurred_at);
create index if not exists {{domain}}_events_correlation_idx  on {{domain}}_events (correlation_id);
create index if not exists {{domain}}_events_type_idx         on {{domain}}_events (event_type);
```

**Field meanings**

| Column | Purpose |
|--------|---------|
| `event_id` | Unique id of THIS event. The idempotency key — dedupe on this. |
| `event_type` | What happened, e.g. `TrendDetected`, `Published`. |
| `schema_version` | Payload version. Additive change → bump. Breaking change → new `event_type` (e.g. `TrendDetectedV2`). |
| `aggregate_id` | The domain object this event is about (e.g. a trend id, a content id). |
| `correlation_id` | Same value copied across every event in one flow. Used for end-to-end tracing. Minted on the first event of a flow (normally `TrendDetected`). |
| `causation_id` | The `event_id` of the event that directly caused this one. Lets you build a cause→effect chain. |
| `payload` | JSONB. All data a subscriber needs, so no cross-domain lookups. |
| `occurred_at` | When the event happened. Order flows by this. |

**Planned stream tables (one writer each):**
`trend_events` (Trend Intelligence), `source_events` (Content Sources), `content_events` (Content Generation), `asset_events` (Media Production), `schedule_events` (Scheduling), `publishing_events` (Publishing), `analytics_events` (Analytics), `learning_events` (Learning), `page_events` (Page Management).
As of M0, none of these exist yet — only `demo_events`.

---

## 3. Tables that currently EXIST (after M0)

### 3.1 `demo_events`  — throwaway proving ground (RAZ-6)
Exact copy of the envelope template above, named `demo_events`. Used to prove delivery (RAZ-7), idempotency (RAZ-8), tracing (RAZ-9), and the sweep (RAZ-10). **Safe to drop once M1 real streams exist.**

### 3.2 `demo_processed` — idempotency "seen" log (RAZ-8)
Records every `event_id` a subscriber has seen. If an id is already here, the event is a duplicate and is skipped. Treated as a **seen log** (an id lands here on arrival), so "not in this table" = "never arrived" — which is what the sweep relies on.

```sql
create table if not exists demo_processed (
    event_id     uuid        primary key,
    processed_at timestamptz not null default now()
);
```

Guard query used by the subscriber (insert-on-conflict-do-nothing; 0 rows returned = duplicate → skip):
```sql
INSERT INTO demo_processed (event_id) VALUES ($1)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;
```

### 3.3 `dead_letter` — failed-processing bucket (RAZ-10)
Events that were delivered but whose processing failed. Visible, not lost. Surfaced in alerts; retried deliberately, not automatically.

```sql
create table if not exists dead_letter (
    id           bigint generated always as identity primary key,
    event_id     uuid        not null,
    stream       text        not null,   -- which stream the event came from
    subscriber   text        not null,   -- which workflow failed to process it
    error        text,                   -- failure reason
    failed_at    timestamptz not null default now()
);
create index if not exists dead_letter_failed_at_idx on dead_letter (failed_at);
```

### 3.4 `sweep_attempts` — re-delivery counter (RAZ-10)
Counts how many times the hourly sweep has re-delivered each still-unseen event. `attempts >= 3` = "stuck" → triggers an alert.

```sql
create table if not exists sweep_attempts (
    event_id     uuid        primary key,
    stream       text        not null,
    attempts     int         not null default 0,
    last_attempt timestamptz not null default now()
);
```

### 3.5 `event_trace` — tracing view (RAZ-9)
A view that reconstructs a full flow by `correlation_id`. Currently unions only `demo_events`; extend with one `union all` block per real stream as they come online.

```sql
create or replace view event_trace as
select 'demo'::text as stream, event_id, event_type, aggregate_id,
       correlation_id, causation_id, occurred_at, payload
from demo_events;
-- Later: union all select 'trend', ... from trend_events;  (one block per stream)
```

Usage:
```sql
select * from event_trace where correlation_id = '<id>' order by occurred_at;
```

---

## 4. Pre-existing production tables (owned by the live workflows A/B/C)

These existed before Content OS and are still driven by the current workflows. **Do not let new domains read/write these directly — events only (ADR-001 §D12).** `content_queue` will eventually become a projection fed by `Queued` events (M5), drained by the Publishing domain (M4).

### 4.1 `content_queue` — the live post queue (hardened in RAZ-11)
Original columns: `id` (serial PK), `post_type`, `caption`, `image_prompt`, `status` (default `pending`), `scheduled_for`, `post_id`, `created_at`, `posted_at`, `page`, `poster_url`.

Status lifecycle: `pending → posting → posted`, plus `failed` / `retry` added in M0.

**RAZ-11 additive columns (safe — nothing renamed/removed):**
```sql
alter table content_queue add column if not exists attempts   int  not null default 0;
alter table content_queue add column if not exists last_error  text;
alter table content_queue add column if not exists updated_at  timestamptz;
```

**RAZ-11 timeout rule** (rescues rows stuck mid-publish; effective once `updated_at` is stamped on `posting`):
```sql
update content_queue
set status = 'failed',
    last_error = 'stuck in posting > 30 min (RAZ-11 timeout rule)',
    updated_at = now()
where status = 'posting'
  and updated_at is not null
  and updated_at < now() - interval '30 minutes';
```
> Note: `updated_at` is NULL on existing rows until a workflow sets it, so the first run intentionally catches nothing. Workflow B / the M4 Publishing domain should stamp `updated_at = now()` whenever it changes a row's status.

### 4.2 `posted_movies` — content-level dedup (owned by Workflow A)
Tracks which movies were posted per page in the last 30 days so the generator doesn't repeat subjects. **Distinct from `demo_processed`:** this is *content* dedup ("already posted this movie"), not *event* idempotency ("already processed this event"). Columns include `page`, `tmdb_id`, `title`, `year`, `posted_at`, with a unique constraint on `(page, title, year)`.

### 4.3 `page_tokens` — publishing credentials/config (owned by Workflow B)
Per-page Facebook token + target countries used by the poster. Will be absorbed by the Page Management domain (M8).

---

## 5. Reliability model (how it all fits)

- **Delivery:** Supabase Database Webhook on INSERT → n8n webhook. Header-auth shared secret guards the endpoint.
- **Duplicates are safe:** subscribers dedupe on `event_id` via `demo_processed` (seen log).
- **Missed deliveries:** hourly sweep finds events with no `demo_processed` row and re-delivers them → at-least-once delivery.
- **Stuck events:** `sweep_attempts.attempts >= 3` → alert.
- **Processing failures:** go to `dead_letter` (visible), not silently dropped.
- **Tracing:** `event_trace` view + `correlation_id` reconstructs any flow.

> Reporting/alerting is a temporary stand-in in the sweep workflow. Its proper home is the **M7 Analytics** domain (daily health report, events-passed, pipeline completion, dead_letter surfacing).

---

## 6. Change log

| Date | Milestone | Change |
|------|-----------|--------|
| 2026-07-10 | M0 · RAZ-6 | Event envelope template + `demo_events`. |
| 2026-07-10 | M0 · RAZ-8 | `demo_processed` idempotency seen-log. |
| 2026-07-10 | M0 · RAZ-9 | `event_trace` view. |
| 2026-07-10 | M0 · RAZ-10 | `dead_letter` + `sweep_attempts`. |
| 2026-07-10 | M0 · RAZ-11 | `content_queue` additive hardening (`attempts`, `last_error`, `updated_at`) + timeout rule. |

> **When you change SQL, add a row here and update the relevant section.**
