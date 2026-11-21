-- Rollback of 0023_crm_attribution_requests.sql. Run only with the owner's approval.
-- Data-preserving: the new columns and the CRM activity table are NOT dropped, so no recorded source, correction or
-- contact is lost. Only the new behaviour is switched off. To remove the columns, export them first and drop them in a
-- separate, explicitly approved step.

drop trigger if exists applications_lead_source_guard on public.applications;
drop function if exists public.lead_source_guard();
drop function if exists public.consume_rate_limit(text, integer, interval);
revoke insert (lead_source, lead_source_detail, submission_token) on public.applications from authenticated;
drop index if exists public.applications_submission_token_key;
alter table public.applications alter column reference
  set default ('GTA-' || to_char(now(), 'YYMM') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)));
-- Services 'european-trips' and 'travel-consultation' were set inactive by 0023. To show them again, the owner sets them
-- active in the admin dashboard; this script does not change them.
