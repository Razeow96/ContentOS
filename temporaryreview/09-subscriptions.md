# Jello — pillar subscriptions (weights + cooldowns)

These become `page_pillar_subscriptions` rows. **Weight** = relative share of the page's generated mix (not a hard quota — scheduler math comes later, M5). **Cooldown** = days before the same (entity × pillar) can repeat without a declared follow-up; goes into `overrides` per row, default is `m3_config.cooldown_days_default = 14`.

| pillar_id | weight | cooldown override | rationale |
|---|---|---|---|
| aftertaste | 3 | default (14) | Signature voice — the register the page is known for |
| the_argument | 3 | 7 | Highest engagement; arguments have legs, revisits tolerated |
| behind_the_scenes | 2 | default (14) | Steady quality lane, depends on interview supply |
| the_numbers | 2 | 21 | Goes stale fastest per entity; longer cooldown |
| nostalgia | 1 | 30 | Powerful but easy to overuse; keep rare |
| burning_now | 1 | 3 | Freshness-gated anyway (48h SLA); short cooldown, low weight — quality of signal decides, not quota |
| lifestyle | 1 | none (n/a) | ~10% of mix per your execution plan; no entity, no cooldown concept |

Edit weights/cooldowns directly in this table — they're config, tunable anytime later (and eventually by Learning from performance data).
