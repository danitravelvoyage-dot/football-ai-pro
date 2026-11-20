-- =====================================================================
-- 0006 — Knowledge base (additive). DO NOT RUN until the owner approves.
-- Structured, verified facts. Nothing is seeded: an entry only exists when the owner enters it.
-- Visa and country facts must cite an official source URL. Unverified entries are never given to agents as fact.
-- =====================================================================

create table if not exists public.ai_kb_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'company_information', 'service_catalogue', 'country_information', 'visa_requirements',
    'sales_knowledge', 'customer_faq', 'content_policies')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  language text not null check (language in ('ar', 'fr', 'en')),
  country text not null check (country in ('dz', 'ma', 'tn', 'all')),
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 10 and 8000),
  official_source_url text check (official_source_url is null or (official_source_url ~ '^https://' and char_length(official_source_url) <= 500)),
  verified_at timestamptz,
  reliability_status text not null default 'unverified' check (reliability_status in (
    'unverified', 'verified_official', 'verified_internal', 'disputed', 'retired')),
  version int not null default 1 check (version >= 1),
  created_by text not null check (char_length(created_by) between 1 and 120),
  updated_at timestamptz not null default now(),
  unique (category, slug, language, country),
  check (category not in ('visa_requirements', 'country_information') or official_source_url is not null),
  check (reliability_status <> 'verified_official' or (official_source_url is not null and verified_at is not null)),
  check (reliability_status <> 'verified_internal' or verified_at is not null)
);
create index if not exists ai_kb_entries_lookup_idx on public.ai_kb_entries (category, country, language);

alter table public.ai_kb_entries enable row level security;

-- Owner writes. Owner and runner read. Entries are retired by status, never deleted.
drop policy if exists ai_kb_entries_read on public.ai_kb_entries;
create policy ai_kb_entries_read on public.ai_kb_entries for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_kb_entries_owner_write on public.ai_kb_entries;
create policy ai_kb_entries_owner_write on public.ai_kb_entries for insert to authenticated with check (public.is_admin());
drop policy if exists ai_kb_entries_owner_update on public.ai_kb_entries;
create policy ai_kb_entries_owner_update on public.ai_kb_entries for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.ai_kb_entries from anon;
