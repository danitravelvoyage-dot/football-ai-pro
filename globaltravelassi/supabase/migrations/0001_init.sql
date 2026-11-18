-- =====================================================================
-- GLOBALTRAVELASSI — database schema, security (RLS) and storage policies
-- Run once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run on a fresh project. Do not edit the policies without review.
-- =====================================================================

-- ---------- 1. Shared helpers -------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- 2. Profiles (one row per auth user) --------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 120),
  whatsapp text not null default '' check (char_length(whatsapp) <= 30),
  role text not null default 'customer' check (role in ('customer', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- True only for an active administrator. SECURITY DEFINER avoids RLS recursion.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active
  );
$$;

-- Customers can never change their own role or activation status through the API.
-- Requests that carry a signed-in user's JWT have auth.uid() set; the SQL Editor has none,
-- so the first administrator can still be created there.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and ((new.role is distinct from old.role)
       or (new.is_active is distinct from old.is_active)
       or (new.id is distinct from old.id)
       or (new.email is distinct from old.email)) then
    if not public.is_admin() then
      raise exception 'Not allowed to change this field' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- New sign-ups always become customers. Role is never read from user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, whatsapp)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    left(coalesce(new.raw_user_meta_data ->> 'whatsapp', ''), 30)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. Services and prices ---------------------------------------

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  category text not null check (category in ('visa', 'appointment', 'e_visa', 'transit', 'european_trip', 'consultation')),
  title_ar text not null check (char_length(title_ar) between 2 and 120),
  title_fr text not null check (char_length(title_fr) between 2 and 120),
  title_en text not null check (char_length(title_en) between 2 and 120),
  description_ar text not null default '' check (char_length(description_ar) <= 1000),
  description_fr text not null default '' check (char_length(description_fr) <= 1000),
  description_en text not null default '' check (char_length(description_en) <= 1000),
  price numeric(12, 2) check (price is null or price >= 0),
  currency text not null default 'DZD' check (currency in ('DZD', 'EUR', 'USD')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

-- ---------- 4. Applications (customer requests) --------------------------

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('GTA-' || to_char(now(), 'YYMM') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))),
  user_id uuid not null references public.profiles (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254),
  whatsapp text not null check (whatsapp ~ '^\+?[0-9]{8,15}$'),
  nationality text not null check (nationality ~ '^[A-Z]{2}$'),
  country_of_residence text not null check (country_of_residence ~ '^[A-Z]{2}$'),
  destination_country text not null check (destination_country ~ '^[A-Z]{2}$'),
  travel_date date,
  employment_status text not null check (employment_status in ('employed', 'self_employed', 'student', 'unemployed', 'retired', 'other')),
  previous_travel_history text not null default '' check (char_length(previous_travel_history) <= 2000),
  additional_info text not null default '' check (char_length(additional_info) <= 2000),
  status text not null default 'new' check (status in ('new', 'in_review', 'documents_required', 'submitted', 'approved', 'rejected', 'completed', 'cancelled')),
  source text check (source is null or char_length(source) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_user_idx on public.applications (user_id);
create index if not exists applications_status_idx on public.applications (status);
create index if not exists applications_created_idx on public.applications (created_at desc);

drop trigger if exists applications_updated_at on public.applications;
create trigger applications_updated_at before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------- 5. Documents (metadata; files live in the private bucket) ----

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  doc_type text not null check (doc_type in ('passport', 'photo', 'bank_statement', 'employment_letter', 'invitation_letter', 'hotel_booking', 'flight_booking', 'civil_status', 'other')),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists documents_application_idx on public.documents (application_id);

-- ---------- 6. Payments (recorded by the admin; never auto-confirmed) ----

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'DZD' check (currency in ('DZD', 'EUR', 'USD')),
  method text not null default 'cash' check (method in ('cash', 'bank_transfer', 'ccp', 'baridimob', 'other')),
  status text not null default 'pending' check (status in ('pending', 'received', 'cancelled')),
  reference text not null default '' check (char_length(reference) <= 100),
  note text not null default '' check (char_length(note) <= 500),
  received_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_received_has_date check (status <> 'received' or received_at is not null)
);

create index if not exists payments_application_idx on public.payments (application_id);

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------- 7. Internal notes (admins only) and customer-visible timeline -

create table if not exists public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists notes_application_idx on public.application_notes (application_id);

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  kind text not null check (kind in ('created', 'status', 'document', 'payment')),
  to_status text,
  message text not null default '' check (char_length(message) <= 300),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists events_application_idx on public.application_events (application_id, created_at);

-- Every new request automatically starts the customer-visible timeline.
create or replace function public.log_application_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.application_events (application_id, kind, to_status, message, actor_id)
  values (new.id, 'created', new.status, '', new.user_id);
  return new;
end $$;

drop trigger if exists applications_created_event on public.applications;
create trigger applications_created_event after insert on public.applications
  for each row execute function public.log_application_created();

-- ---------- 8. Row Level Security ----------------------------------------

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.applications enable row level security;
alter table public.documents enable row level security;
alter table public.payments enable row level security;
alter table public.application_notes enable row level security;
alter table public.application_events enable row level security;

-- Column-level privileges: customers may edit only their name and WhatsApp.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, whatsapp, role, is_active) on public.profiles to authenticated;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- services: visitors see active services; admins manage everything
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon, authenticated
  using (is_active or public.is_admin());

drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- applications: owners read their own and create one in an active service
drop policy if exists applications_owner_read on public.applications;
create policy applications_owner_read on public.applications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists applications_owner_insert on public.applications;
create policy applications_owner_insert on public.applications for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'new'
    and exists (select 1 from public.services s where s.id = service_id and s.is_active)
  );

drop policy if exists applications_admin_update on public.applications;
create policy applications_admin_update on public.applications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists applications_admin_delete on public.applications;
create policy applications_admin_delete on public.applications for delete to authenticated
  using (public.is_admin());

-- documents: owners upload/read/remove their own files until review starts
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert on public.documents for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid() and a.status in ('new', 'documents_required')
    )
  );

drop policy if exists documents_owner_delete on public.documents;
create policy documents_owner_delete on public.documents for delete to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and exists (
      select 1 from public.applications a
      where a.id = application_id and a.status in ('new', 'documents_required')
    ))
  );

drop policy if exists documents_admin_update on public.documents;
create policy documents_admin_update on public.documents for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- payments: admins manage; the owner sees the payments of their own requests
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid())
  );

drop policy if exists payments_admin_write on public.payments;
create policy payments_admin_write on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- internal notes: admins only (never visible to customers)
drop policy if exists notes_admin_all on public.application_notes;
create policy notes_admin_all on public.application_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- timeline: customers see events on their own requests; admins write them
drop policy if exists events_read on public.application_events;
create policy events_read on public.application_events for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid())
  );

drop policy if exists events_admin_write on public.application_events;
create policy events_admin_write on public.application_events for insert to authenticated
  with check (public.is_admin());

-- Anonymous visitors get no direct table access except active services.
revoke all on public.profiles, public.applications, public.documents, public.payments,
  public.application_notes, public.application_events from anon;

-- ---------- 9. Private document storage ----------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-documents', 'customer-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

-- Files are stored under <user_id>/<application_id>/<file>. Only the owner (first folder
-- segment) or an admin can read, upload or delete. Nobody can overwrite files (no UPDATE policy).
drop policy if exists "docs_owner_upload" on storage.objects;
create policy "docs_owner_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "docs_owner_or_admin_read" on storage.objects;
create policy "docs_owner_or_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "docs_owner_or_admin_delete" on storage.objects;
create policy "docs_owner_or_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'customer-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
