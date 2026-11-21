-- Rollback of 0022_remove_payment_workflow.sql. Run only with the owner's approval.
--
-- What this script restores: the customer payment view, the timeline view including payment events, and the policies
-- and grants the payment screens used. Payment rows were never removed by 0022, so nothing is lost.
--
-- What it does NOT restore: the payment FUNCTIONS (submit_payment_evidence, decide_payment, save_payment_method,
-- record_manual_payment, set_manual_payment_status, the orphan-proof functions). Re-create them by running the function
-- definitions in supabase/migrations/0019_manual_payments.sql, section 7, in the SQL editor, before the application that
-- uses them is redeployed. Without them the payment screens fail.
--
-- The payment-email trigger is removed, so payment emails can be queued again, if the application still sends them.

drop trigger if exists customer_email_no_payment on public.customer_email_notifications;
drop function if exists public.block_payment_emails();

create or replace view public.customer_payments as
  select p.id, p.application_id, p.amount, p.currency, p.method, p.status, p.reference, p.received_at, p.created_at,
         p.submitted_at, p.customer_visible_rejection_message
    from public.payments p
    join public.applications a on a.id = p.application_id
   where a.user_id = auth.uid();
revoke all on public.customer_payments from anon, public;
grant select on public.customer_payments to authenticated;

create or replace view public.customer_application_events as
  select e.id, e.application_id, e.kind, e.to_status, e.message, e.created_at
    from public.application_events e
    join public.applications a on a.id = e.application_id
   where a.user_id = auth.uid();
revoke all on public.customer_application_events from anon, public;
grant select on public.customer_application_events to authenticated;

grant select on public.payments, public.payment_method_settings, public.payment_method_history, public.payment_audit, public.proof_removals to authenticated;
create policy payments_read on public.payments for select to authenticated using (public.is_admin());
create policy payment_settings_read on public.payment_method_settings for select to authenticated using (true);
create policy payment_audit_read on public.payment_audit for select to authenticated using (public.is_admin());
create policy payment_history_read on public.payment_method_history for select to authenticated using (public.is_admin());
create policy proof_removals_read on public.proof_removals for select to authenticated using (public.is_admin());
