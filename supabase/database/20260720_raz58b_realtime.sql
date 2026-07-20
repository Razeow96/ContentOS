-- M0 · Infrastructure — enable Realtime (true push) on the observability tables
-- so the /admin Infrastructure console updates live via websocket instead of
-- polling (RAZ-58). INSERT streaming only; default replica identity (PK) suffices.
-- Idempotent: adding a table already in the publication errors, so guard it.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'run_log'
  ) then
    alter publication supabase_realtime add table run_log;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'api_request_log'
  ) then
    alter publication supabase_realtime add table api_request_log;
  end if;
end $$;
