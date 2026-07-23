-- RAZ-73 (RAZ-71 follow-up) · page-id parity, missed table.
-- RAZ-71 reconciled page_trend_sources jello_topmovie_svs → jello, but
-- page_trend_settings (the trends_enabled gate read by m1-trend's
-- loadSubscriptions) still held the old id — so jello's trend subscriptions
-- were silently gated out of every campaign. Same bug class, third table:
-- ONE page = ONE id, EVERYWHERE.
update page_trend_settings
set page_id = 'jello'
where page_id = 'jello_topmovie_svs';
