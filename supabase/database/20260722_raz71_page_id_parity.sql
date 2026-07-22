-- RAZ-71 (Stage 1 of RAZ-61) · page_id parity — one id end-to-end.
-- Fixes G2: page_trend_sources subscribed trends under 'jello_topmovie_svs', but
-- page_identity / pillars / characters all live under 'jello'. A trend-originated
-- event hit m3-generate loadContext('jello_topmovie_svs') = NULL → skip "no identity",
-- killing the whole trend path at M3. 'jello_topmovie_svs' has no identity of its
-- own — it is an orphan alias of the real page 'jello'. Reconcile to the canonical id.
-- IDEMPOTENT: the WHERE clause makes a re-run a no-op.

update page_trend_sources
   set page_id = 'jello'
 where page_id = 'jello_topmovie_svs';

-- Verify (expect 0 orphan rows, and the page's trend subs now under 'jello'):
--   select page_id, count(*) from page_trend_sources group by page_id order by page_id;
--   select count(*) as orphans from page_trend_sources where page_id = 'jello_topmovie_svs';
--
-- Rollback (only if 'jello_topmovie_svs' was genuinely a separate page — it is not):
--   update page_trend_sources set page_id='jello_topmovie_svs' where page_id='jello';
