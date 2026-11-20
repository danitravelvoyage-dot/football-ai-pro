-- =====================================================================
-- 0010 — Append-only hardening (additive). DO NOT RUN until the owner approves.
-- Closes two gaps found by the security audit:
--  1. ai_events had no row trigger, so only RLS protected it. The database owner role bypasses RLS.
--  2. TRUNCATE is not a row operation: row policies and row triggers do not apply to it.
-- Adds: a row trigger on ai_events, a statement-level trigger that refuses TRUNCATE on every append-only
-- table, and a revoke of TRUNCATE from the API roles. Uses the existing ai_append_only() function (0004).
-- Limit: a database owner can still disable a trigger. That is a privilege, not a bypass, and the
-- audit report says so.
-- =====================================================================

drop trigger if exists ai_events_append_only on public.ai_events;
create trigger ai_events_append_only before update or delete on public.ai_events
  for each row execute function public.ai_append_only();

do $$
declare
  t text;
begin
  foreach t in array array['ai_events', 'ai_domain_events', 'ai_context_versions', 'ai_quality_reviews', 'ai_owner_decisions', 'ai_experiment_results'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.ai_append_only()', t || '_no_truncate', t);
    execute format('revoke truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;
