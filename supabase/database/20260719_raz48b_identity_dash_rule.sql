-- RAZ-48b · Owner rule addition (2026-07-19): NO dashes in generated copy —
-- "-", "--", and the Chinese em-dash "—/——" are banned (em-dash is the #1
-- AI-tell in Chinese copy). Also adds forbidden_patterns as MACHINE-READABLE
-- validator config: hard rules with "no room of error" get enforced in code
-- (m3-generate post-generation check), not just requested in prose.
-- IDEMPOTENT: safe to re-run.

alter table page_identity
  add column if not exists forbidden_patterns jsonb not null default '[]'::jsonb;

comment on column page_identity.forbidden_patterns is
  'Machine-enforced ban list for generated copy. m3-generate validates drafts against these AFTER generation: violation -> one auto-revise pass -> else flag draft. Prose rules steer the model; this list guarantees. (RAZ-48b)';

update page_identity
   set hard_rules_md = hard_rules_md || E'\n9. No dashes in copy: "-", "--" and the Chinese em-dash 「—」/「——」 are forbidden. Use 、 ， ： or a line break instead.',
       forbidden_patterns = '["—","--"]'::jsonb
 where page_id = 'jello'
   and hard_rules_md not like '%No dashes in copy%';

-- Verify:
--   select forbidden_patterns, hard_rules_md from page_identity where page_id='jello';
