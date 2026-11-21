-- Rollback of 0021_customer_email_notifications.sql. Run only with the owner's approval.
-- The email log is kept: the table is not dropped, so the record of what was sent survives. Only the functions are
-- removed, which stops new emails from being queued. To remove the table as well, export it first, then drop it in a
-- separate, explicitly approved step.

drop function if exists public.claim_customer_email_retry(uuid);
drop function if exists public.record_customer_email_delivery(uuid, text, text, text);
drop function if exists public.enqueue_customer_email(text, uuid);
