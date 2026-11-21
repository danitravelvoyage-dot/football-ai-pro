-- 0023: CRM essentials, lead source attribution, duplicate protection and rate limiting for service requests.
-- Additive. No row or column that holds data is removed. Not applied anywhere yet: needs the owner's approval.
--
-- Depends on 0001 (applications, profiles), 0019 (append_only_guard) and 0020 (applications.locale, is_active_account()).
-- Rollback: docs/migrations/0023_rollback.sql.

-- ---------- 1. Request attribution and CRM fields ----------------------------------------------------------------------

alter table public.applications
  add column if not exists lead_source text
    check (lead_source is null or lead_source in ('tiktok', 'instagram', 'facebook', 'google', 'whatsapp', 'direct', 'other')),
  add column if not exists lead_source_detail text
    check (lead_source_detail is null or char_length(lead_source_detail) <= 100),
  add column if not exists lead_source_corrected_by uuid references public.profiles (id) on delete set null,
  add column if not exists lead_source_corrected_at timestamptz,
  add column if not exists submission_token uuid,
  add column if not exists customer_category text not null default 'standard'
    check (customer_category in ('standard', 'priority', 'returning', 'corporate')),
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_contact_channel text
    check (last_contact_channel is null or last_contact_channel in ('whatsapp', 'email', 'phone', 'in_person', 'other'));

-- A submission token is used once per customer: a double submit returns the first request, never a second one.
create unique index if not exists applications_submission_token_key
  on public.applications (user_id, submission_token) where submission_token is not null;
create index if not exists applications_lead_source_idx on public.applications (lead_source);
create index if not exists applications_locale_idx on public.applications (locale);

-- The reference is 10 random hex characters (40 bits), not derived from the clock. Existing references are unchanged.
alter table public.applications alter column reference
  set default ('GTA-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

-- Customers may set the attribution and the token on their own new request; they may never update it afterwards.
grant insert (lead_source, lead_source_detail, submission_token) on public.applications to authenticated;

-- A recorded source is never overwritten silently: a change needs the correcting administrator recorded in the same
-- row. A source that was never recorded (legacy rows) may be filled in.
create or replace function public.lead_source_guard()
returns trigger language plpgsql as $$
begin
  if old.lead_source is not null and new.lead_source is distinct from old.lead_source
     and new.lead_source_corrected_by is null then
    raise exception 'A recorded lead source can only be corrected by an administrator, with the correction recorded.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists applications_lead_source_guard on public.applications;
create trigger applications_lead_source_guard before update on public.applications
  for each row execute function public.lead_source_guard();
revoke all on function public.lead_source_guard() from public, anon, authenticated;

-- ---------- 2. Internal CRM activity (admins only, append-only) ----------------------------------------------------------

create table if not exists public.crm_activity (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key on purpose: the activity record must outlive a deleted request.
  application_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('source_corrected', 'contact_logged', 'category_changed', 'status_changed', 'lead_recorded')),
  detail text not null check (char_length(detail) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists crm_activity_application_idx on public.crm_activity (application_id, created_at);

alter table public.crm_activity enable row level security;
drop policy if exists crm_activity_admin_read on public.crm_activity;
create policy crm_activity_admin_read on public.crm_activity for select to authenticated using (public.is_admin());
drop policy if exists crm_activity_admin_insert on public.crm_activity;
create policy crm_activity_admin_insert on public.crm_activity for insert to authenticated with check (public.is_admin() and actor_id = auth.uid());
revoke all on public.crm_activity from anon;
revoke update, delete, truncate on public.crm_activity from authenticated;

drop trigger if exists crm_activity_no_change on public.crm_activity;
create trigger crm_activity_no_change before update or delete on public.crm_activity
  for each row execute function public.append_only_guard();
drop trigger if exists crm_activity_no_truncate on public.crm_activity;
create trigger crm_activity_no_truncate before truncate on public.crm_activity
  for each statement execute function public.append_only_guard();

-- ---------- 3. Rate limiting for service requests ------------------------------------------------------------------------

-- Counters only: a key is a hash computed by the application (never a raw address or identifier). No client can read or
-- write the table; only consume_rate_limit() changes it.
create table if not exists public.rate_limit_hits (
  bucket_key text not null check (char_length(bucket_key) between 8 and 120),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket_key, window_start)
);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  ws timestamptz;
  n integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_window < interval '1 minute' or p_window > interval '1 day' then
    raise exception 'Invalid rate limit.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_key, '')) < 8 or char_length(p_key) > 120 then
    raise exception 'Invalid rate limit key.' using errcode = 'check_violation';
  end if;
  ws := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00');
  insert into public.rate_limit_hits as h (bucket_key, window_start, hits) values (p_key, ws, 1)
  on conflict (bucket_key, window_start) do update set hits = h.hits + 1
  returning h.hits into n;
  return n <= p_limit;
end $$;

revoke all on function public.consume_rate_limit(text, integer, interval) from public, anon;
grant execute on function public.consume_rate_limit(text, integer, interval) to authenticated;

-- ---------- 4. Services: the nine services of the business only -----------------------------------------------------------

-- The starter catalogue has two services that the business does not offer. They are hidden, not deleted, so any prices
-- or history the owner set stay in place. The owner can turn them back on in the admin dashboard.
update public.services set is_active = false
 where slug in ('european-trips', 'travel-consultation') and is_active;
