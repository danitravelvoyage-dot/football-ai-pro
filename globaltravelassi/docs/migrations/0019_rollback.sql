-- ROLLBACK for supabase/migrations/0019_manual_payments.sql. NOT part of the migration chain.
-- Run only with the owner's approval, after the backup in docs/migrations/0018_backup_procedure.md is taken and verified,
-- and with:  set gta.rollback_confirmed = 'yes';
--
-- IRREVERSIBLE OPERATIONS (each one is preceded by a verified copy in an archive table; nothing is deleted from storage):
--   1. The 0019 payment columns (evidence, submission, decision, customer message) leave the live payments table.
--      The full payments table is copied to payments_archive_0019 first, and checksum-verified.
--   2. payment_audit, payment_method_history, payment_method_settings and proof_removals leave the live schema.
--      Each is copied to <name>_archive_0019 first, and checksum-verified.
--   3. The 0019 functions, views, guards and the customer views are dropped. The 0001 policies and grants are restored.
--   4. The 0019 status constraints are replaced by the 0001 ones. The status constraints are only restorable while no row
--      uses a 0019 state.
--
-- REFUSED, with nothing changed, while any of these exists (the owner decides first; this script never decides for them):
--   - a proof (evidence_path set) on any payment: proofs are evidence and are not dropped silently;
--   - a payment in pending_review or rejected, or a method usdt or redotpay;
--   - a request in payment_pending.
--
-- The whole script is one transaction: any failed check leaves the database exactly as it was, archives included.
-- Storage objects (proof files and documents) are never touched by this script.

begin;

do $$
begin
  if coalesce(current_setting('gta.rollback_confirmed', true), '') <> 'yes' then
    raise exception 'Rollback refused: set gta.rollback_confirmed to yes after the backup is verified.';
  end if;
  if to_regclass('public.payments_archive_0019') is not null or to_regclass('public.payment_audit_archive_0019') is not null
     or to_regclass('public.payment_method_settings_archive_0019') is not null or to_regclass('public.payment_method_history_archive_0019') is not null
     or to_regclass('public.proof_removals_archive_0019') is not null then
    raise exception 'Rollback refused: an archive from an earlier rollback exists. Keep it; do not overwrite it.';
  end if;
end $$;

-- 1-2. Copy first. Archives are readable by the owner only, and never written by the API roles.
create table public.payments_archive_0019 as select * from public.payments;
create table public.payment_audit_archive_0019 as select * from public.payment_audit;
create table public.payment_method_settings_archive_0019 as select * from public.payment_method_settings;
create table public.payment_method_history_archive_0019 as select * from public.payment_method_history;
create table public.proof_removals_archive_0019 as select * from public.proof_removals;

do $$
declare t text;
begin
  foreach t in array array['payments_archive_0019', 'payment_audit_archive_0019', 'payment_method_settings_archive_0019',
                           'payment_method_history_archive_0019', 'proof_removals_archive_0019'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_owner_read', t);
  end loop;
end $$;

-- Verify the copies before anything is dropped: same row count and the same checksum over the fields that matter.
do $$
begin
  if (select count(*) from public.payments_archive_0019) <> (select count(*) from public.payments)
     or (select md5(string_agg(id::text || ':' || status || ':' || amount::text, ',' order by id)) from public.payments_archive_0019)
        is distinct from (select md5(string_agg(id::text || ':' || status || ':' || amount::text, ',' order by id)) from public.payments) then
    raise exception 'Payments archive does not match the live table. Nothing was dropped.';
  end if;
  if (select count(*) from public.payment_audit_archive_0019) <> (select count(*) from public.payment_audit)
     or (select count(*) from public.payment_method_history_archive_0019) <> (select count(*) from public.payment_method_history)
     or (select count(*) from public.payment_method_settings_archive_0019) <> (select count(*) from public.payment_method_settings)
     or (select count(*) from public.proof_removals_archive_0019) <> (select count(*) from public.proof_removals) then
    raise exception 'An audit or settings archive does not match its live table. Nothing was dropped.';
  end if;
end $$;

-- 3. Compatibility gate: refuse while any row uses a 0019 state. Nothing is decided here.
do $$
declare
  proofs integer;
  open_states integer;
  pending_apps integer;
begin
  select count(*) into proofs from public.payments where evidence_path is not null;
  select count(*) into open_states from public.payments where status in ('pending_review', 'rejected') or method in ('usdt', 'redotpay');
  select count(*) into pending_apps from public.applications where status = 'payment_pending';
  if proofs > 0 or open_states > 0 or pending_apps > 0 then
    raise exception 'Rollback refused: % payment proofs, % payments in a 0019 state and % requests awaiting payment exist. Decide them first. Nothing was changed.',
      proofs, open_states, pending_apps;
  end if;
end $$;

-- 4. Views, policies and grants back to 0001.
drop view if exists public.customer_payments;
drop view if exists public.customer_application_events;
drop policy if exists "docs_owner_or_admin_delete" on storage.objects;
create policy "docs_owner_or_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'customer-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid()));
create policy payments_admin_write on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.payments to authenticated;
drop policy if exists events_admin_read on public.application_events;
create policy events_read on public.application_events for select to authenticated
  using (public.is_admin() or exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid()));
grant update, delete, truncate on public.application_events to authenticated;

-- 5. Guards, functions and the 0019 tables.
drop trigger if exists payments_guard on public.payments;
drop trigger if exists payments_no_delete_with_proof on public.payments;
drop trigger if exists payments_insert_guard on public.payments;
drop function if exists public.payment_guard();
drop function if exists public.payment_no_delete_with_proof();
drop function if exists public.payment_insert_guard();
drop function if exists public.proof_is_referenced(text);
drop function if exists public.submit_payment_evidence(uuid, text, text, text, integer, text);
drop function if exists public.decide_payment(uuid, text, text, text);
drop function if exists public.save_payment_method(text, boolean, text, text, text, text);
drop function if exists public.record_manual_payment(uuid, numeric, text, text, text, text, text, date);
drop function if exists public.set_manual_payment_status(uuid, text);
drop function if exists public.delete_application_request(uuid);
drop function if exists public.orphan_payment_proofs(interval);
drop function if exists public.orphan_proof_still_eligible(text, interval);
drop function if exists public.begin_orphan_removal(text, text, interval);
drop function if exists public.finish_orphan_removal(uuid, boolean, text);
drop function if exists public.reconcile_orphan_removals(interval);
drop table public.payment_audit;
drop table public.payment_method_history;
drop table public.payment_method_settings;
drop table public.proof_removals;
drop function if exists public.append_only_guard();

-- 6. Payment columns and constraints back to 0001.
drop index if exists public.payments_one_open_review;
alter table public.payments drop constraint if exists payments_rejected_has_message;
alter table public.payments drop constraint if exists payments_decided_has_owner;
alter table public.payments drop constraint if exists payments_pending_review_has_evidence;
alter table public.payments drop constraint if exists payments_evidence_complete;
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('pending', 'received', 'cancelled'));
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash', 'bank_transfer', 'ccp', 'baridimob', 'other'));
alter table public.payments drop column if exists customer_visible_rejection_message;
alter table public.payments drop column if exists decision_reason;
alter table public.payments drop column if exists verified_at;
alter table public.payments drop column if exists verified_by;
alter table public.payments drop column if exists submitted_by;
alter table public.payments drop column if exists submitted_at;
alter table public.payments drop column if exists evidence_size;
alter table public.payments drop column if exists evidence_mime;
alter table public.payments drop column if exists evidence_path;
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (
  status in ('new', 'in_review', 'documents_required', 'submitted', 'approved', 'rejected', 'completed', 'cancelled')
);

-- 7. Verify: the live payments are the archived payments, row for row.
do $$
begin
  if (select md5(string_agg(id::text || ':' || status || ':' || amount::text, ',' order by id)) from public.payments)
     is distinct from (select md5(string_agg(id::text || ':' || status || ':' || amount::text, ',' order by id)) from public.payments_archive_0019) then
    raise exception 'Post-rollback check failed: live payments differ from the archive. Rolled back.';
  end if;
end $$;

commit;
