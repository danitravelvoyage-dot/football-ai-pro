-- 0022: removes the payment workflow from the database. Forward-only. Not applied anywhere yet: applying it needs the
-- owner's approval.
--
-- Historical data is PRESERVED. This migration does not drop a table, a column, a row or a policy that holds data.
-- It removes the write paths and the customer-facing access:
--   1. the payment functions (their data and history remain in the payment tables);
--   2. the customer payment view (customers can no longer read payment rows through the API);
--   3. customer-visible timeline rows of kind 'payment' (the rows stay; the view stops returning them);
--   4. direct API access to every payment table for signed-in users (owner-side reads keep the audit trail reachable
--      through the database owner, for records);
--   5. payment emails: the email log refuses new payment kinds. Existing log rows are kept.
--
-- Depends on 0019 (payment tables and functions), 0020 and 0021 (email log).
-- Rollback: docs/migrations/0022_rollback.sql. It restores the functions and grants only; it cannot restore dropped
-- function bodies except from 0019, so the rollback re-runs the 0019 definitions and refuses if this file changed.

-- ---------- 1. Payment functions (their tables and rows are kept) ------------------------------------------------------

drop function if exists public.submit_payment_evidence(uuid, text, text, text, integer, text);
drop function if exists public.decide_payment(uuid, text, text, text);
drop function if exists public.save_payment_method(text, boolean, text, text, text, text);
drop function if exists public.record_manual_payment(uuid, numeric, text, text, text, text, text, date);
drop function if exists public.set_manual_payment_status(uuid, text);
drop function if exists public.orphan_payment_proofs(interval);
drop function if exists public.orphan_proof_still_eligible(text, interval);
drop function if exists public.begin_orphan_removal(text, text, interval);
drop function if exists public.finish_orphan_removal(uuid, boolean, text);
drop function if exists public.reconcile_orphan_removals(interval);

-- ---------- 2. Customer payment view ----------------------------------------------------------------------------------

drop view if exists public.customer_payments;

-- ---------- 3. Customer timeline: no payment events --------------------------------------------------------------------

create or replace view public.customer_application_events as
  select e.id, e.application_id, e.kind, e.to_status, e.message, e.created_at
    from public.application_events e
    join public.applications a on a.id = e.application_id
   where a.user_id = auth.uid()
     and e.kind <> 'payment';

revoke all on public.customer_application_events from anon, public;
grant select on public.customer_application_events to authenticated;

-- ---------- 4. No signed-in user reaches the payment tables through the API ---------------------------------------------

revoke all on public.payments, public.payment_method_settings, public.payment_method_history,
  public.payment_audit, public.proof_removals from authenticated;

-- The payment screens and functions are gone, so the policies that exposed these tables are removed as well. Rows
-- stay in place.
drop policy if exists payments_read on public.payments;
drop policy if exists payment_settings_read on public.payment_method_settings;
drop policy if exists payment_audit_read on public.payment_audit;
drop policy if exists payment_history_read on public.payment_method_history;
drop policy if exists proof_removals_read on public.proof_removals;

-- ---------- 5. Payment emails are no longer queued --------------------------------------------------------------------

create or replace function public.block_payment_emails()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if left(new.kind, 8) = 'payment_' then
    raise exception 'Payment emails are no longer sent.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists customer_email_no_payment on public.customer_email_notifications;
create trigger customer_email_no_payment before insert on public.customer_email_notifications
  for each row execute function public.block_payment_emails();

revoke all on function public.block_payment_emails() from public, anon, authenticated;
