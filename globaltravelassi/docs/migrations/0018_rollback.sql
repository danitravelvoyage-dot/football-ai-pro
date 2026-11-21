-- ROLLBACK for supabase/migrations/0018_owner_approval_center.sql.
-- NOT part of the migration chain. Run only with the owner's approval, after the backup in 0018_backup_procedure.md
-- is taken and verified, and with: set gta.rollback_confirmed = 'yes';
--
-- DESTRUCTIVE OPERATIONS (each one is preceded by a verified copy; nothing is deleted from the database):
--   1. ai_review_items leaves the live schema. Its rows are copied to ai_review_items_archive and checksum-verified first.
--   2. Registry metadata (category, jurisdiction, status, expiry, validation, version, reason) is removed from
--      ai_sources_allowlist. The full rows are copied to ai_sources_allowlist_archive and checksum-verified first.
--   3. ai_leads.version is removed. It is a concurrency token only; the next write after a restore has no version to compare.
--   4. Triggers, functions and policies added by 0018 are dropped. The 0002 policy is restored. The delete grant is NOT
--      restored: no client role can delete a registry host after the rollback either. The audit trail keeps its revoked
--      UPDATE, DELETE and TRUNCATE for client roles: the rollback does not reopen the audit table.
-- NOT touched: ai_events (audit history, append-only), lead rows, host rows (host, purpose, approver), any other table.
-- The whole script is one transaction: a failed check leaves the database exactly as it was.

begin;

do $$
begin
  if coalesce(current_setting('gta.rollback_confirmed', true), '') <> 'yes' then
    raise exception 'Rollback refused: set gta.rollback_confirmed to yes after the backup is verified.';
  end if;
  if to_regclass('public.ai_review_items_archive') is not null or to_regclass('public.ai_sources_allowlist_archive') is not null then
    raise exception 'Rollback refused: an archive from an earlier rollback exists. Keep it; do not overwrite it.';
  end if;
end $$;

-- 1-2. Copy first. The archives are read-only for the API roles and readable by the owner only.
create table public.ai_review_items_archive as select * from public.ai_review_items;
create table public.ai_sources_allowlist_archive as select * from public.ai_sources_allowlist;

alter table public.ai_review_items_archive enable row level security;
alter table public.ai_sources_allowlist_archive enable row level security;
revoke all on public.ai_review_items_archive, public.ai_sources_allowlist_archive from anon, authenticated;
grant select on public.ai_review_items_archive, public.ai_sources_allowlist_archive to authenticated;
create policy ai_review_items_archive_read on public.ai_review_items_archive for select to authenticated using (public.is_admin());
create policy ai_sources_allowlist_archive_read on public.ai_sources_allowlist_archive for select to authenticated using (public.is_admin());

-- Verify the copies before anything is dropped: same row count and the same checksum over the fields that matter.
do $$
begin
  if (select count(*) from public.ai_review_items_archive) <> (select count(*) from public.ai_review_items)
     or (select md5(string_agg(id::text || ':' || status || ':' || version::text, ',' order by id)) from public.ai_review_items_archive)
        is distinct from (select md5(string_agg(id::text || ':' || status || ':' || version::text, ',' order by id)) from public.ai_review_items) then
    raise exception 'Review item archive does not match the live table. Nothing was dropped.';
  end if;
  if (select count(*) from public.ai_sources_allowlist_archive) <> (select count(*) from public.ai_sources_allowlist)
     or (select md5(string_agg(host || ':' || status || ':' || version::text, ',' order by host)) from public.ai_sources_allowlist_archive)
        is distinct from (select md5(string_agg(host || ':' || status || ':' || version::text, ',' order by host)) from public.ai_sources_allowlist) then
    raise exception 'Source archive does not match the live table. Nothing was dropped.';
  end if;
end $$;

-- 3. Review items: triggers, functions and the table itself (its rows are archived above).
drop trigger if exists ai_review_items_audit on public.ai_review_items;
drop trigger if exists ai_review_items_guard on public.ai_review_items;
drop function if exists public.ai_review_audit();
drop function if exists public.ai_review_item_guard();
drop table public.ai_review_items;

-- 4. Leads: the concurrency version.
drop trigger if exists ai_leads_version on public.ai_leads;
drop function if exists public.ai_lead_version_bump();
alter table public.ai_leads drop column if exists version;

-- 5. Sources: triggers, functions, the 0018 policies, then the metadata columns. The 0002 policy comes back.
drop trigger if exists ai_sources_allowlist_audit on public.ai_sources_allowlist;
drop trigger if exists ai_sources_allowlist_guard on public.ai_sources_allowlist;
drop function if exists public.ai_source_audit();
drop function if exists public.ai_source_guard();
drop function if exists public.ai_reactivate_source(text, int, text, uuid);
drop function if exists public.ai_audit_integrity_report();
drop policy if exists ai_sources_read on public.ai_sources_allowlist;
drop policy if exists ai_sources_owner_insert on public.ai_sources_allowlist;
drop policy if exists ai_sources_owner_update on public.ai_sources_allowlist;
create policy ai_sources_admin on public.ai_sources_allowlist for all to authenticated using (public.is_admin()) with check (public.is_admin());
alter table public.ai_sources_allowlist drop column if exists last_change_reason;
alter table public.ai_sources_allowlist drop column if exists version;
alter table public.ai_sources_allowlist drop column if exists updated_at;
alter table public.ai_sources_allowlist drop column if exists validated_at;
alter table public.ai_sources_allowlist drop column if exists expires_at;
alter table public.ai_sources_allowlist drop column if exists status;
alter table public.ai_sources_allowlist drop column if exists jurisdiction;
alter table public.ai_sources_allowlist drop column if exists category;

commit;
