# m1-trend — M1 Trend Intelligence (signals, not material)
- Only writer of `trend_events`. Never read/write another domain's tables (D12).
- Volume rule: signals stay {value, unit, source} — NEVER merged or compared
  across platforms (views ≠ searches ≠ likes).
- Sources live in trendsource.json (config-as-data); page wiring in
  page_trend_sources. Contract: TrendDetected v1 (Linear).
- Known debt: adapters still bypass guardedFetch — RAZ-54 before touching them.

## Learned rules
(appended only after a mistake's fix is proven and Raze approves — see root CLAUDE.md)
