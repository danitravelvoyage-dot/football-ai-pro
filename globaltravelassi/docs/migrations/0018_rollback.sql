-- ROLLBACK for supabase/migrations/0018_owner_approval_center.sql. NOT part of the migration chain.
-- Run only with the owner's approval, and only after exporting ai_review_items (it is lost on rollback).
-- Leads and sources keep their rows: only the columns and triggers added by 0018 are removed.

drop trigger if exists ai_review_items_guard on public.ai_review_items;
drop function if exists public.ai_review_item_guard();
drop table if exists public.ai_review_items;

drop trigger if exists ai_leads_version on public.ai_leads;
drop function if exists public.ai_lead_version_bump();
alter table public.ai_leads drop column if exists version;

drop trigger if exists ai_sources_allowlist_version on public.ai_sources_allowlist;
drop function if exists public.ai_source_version_bump();
alter table public.ai_sources_allowlist drop column if exists version;
alter table public.ai_sources_allowlist drop column if exists updated_at;
alter table public.ai_sources_allowlist drop column if exists validated_at;
alter table public.ai_sources_allowlist drop column if exists expires_at;
alter table public.ai_sources_allowlist drop column if exists status;
alter table public.ai_sources_allowlist drop column if exists jurisdiction;
alter table public.ai_sources_allowlist drop column if exists category;
