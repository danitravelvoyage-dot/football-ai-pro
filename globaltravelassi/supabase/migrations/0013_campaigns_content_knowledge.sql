-- 0013: campaign management, content review history and knowledge base versions.
-- Additive only. Not applied to any database by the change that adds it: applying it needs owner approval.
--
-- Writes to campaigns, reviews and knowledge are made by the owner's session, through the application's services.
-- Platform roles can read them. History tables are append-only: no update or delete policy exists.

-- ---------- 1. Campaign columns (ai_campaigns exists from 0002) ----------------

alter table public.ai_campaigns add column if not exists objective text
  check (objective is null or objective in ('awareness', 'leads', 'applications', 'conversions'));
alter table public.ai_campaigns add column if not exists kpis jsonb not null default '[]'::jsonb
  -- Existing rows have no KPIs, so the database allows zero. The application requires one or more when a campaign is created.
  check (jsonb_typeof(kpis) = 'array' and jsonb_array_length(kpis) <= 5);
alter table public.ai_campaigns add column if not exists budget_minor bigint not null default 0
  check (budget_minor between 0 and 10000000000);
alter table public.ai_campaigns add column if not exists currency text not null default 'DZD'
  check (currency in ('DZD', 'EUR', 'USD'));
alter table public.ai_campaigns add column if not exists starts_on date;
alter table public.ai_campaigns add column if not exists ends_on date;
alter table public.ai_campaigns add column if not exists archived_at timestamptz;
alter table public.ai_campaigns add column if not exists updated_at timestamptz not null default now();

-- ---------- 2. Campaign relations and history ------------------------------------

create table if not exists public.ai_campaign_agents (
  campaign_id uuid not null references public.ai_campaigns (id) on delete cascade,
  agent text not null references public.ai_agents (key),
  assigned_at timestamptz not null default now(),
  primary key (campaign_id, agent)
);

create table if not exists public.ai_campaign_content (
  campaign_id uuid not null references public.ai_campaigns (id) on delete cascade,
  artifact_id uuid not null references public.ai_artifacts (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (campaign_id, artifact_id)
);

create table if not exists public.ai_campaign_spend (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ai_campaigns (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  note text not null check (char_length(note) between 1 and 200),
  spent_at timestamptz not null default now()
);

create table if not exists public.ai_campaign_kpi_readings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ai_campaigns (id) on delete cascade,
  metric text not null check (char_length(metric) between 2 and 40),
  value numeric not null check (value >= 0),
  period text not null check (char_length(period) between 3 and 40),
  recorded_at timestamptz not null default now()
);

create table if not exists public.ai_campaign_events (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  campaign_id uuid not null references public.ai_campaigns (id) on delete cascade,
  event_type text not null check (char_length(event_type) between 2 and 60),
  detail jsonb not null default '{}'::jsonb,
  actor text not null check (char_length(actor) between 1 and 120),
  at timestamptz not null default now()
);

-- ---------- 3. Content review history -------------------------------------------

create table if not exists public.ai_content_reviews (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  artifact_id uuid not null references public.ai_artifacts (id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected', 'revision_requested')),
  note text check (note is null or char_length(note) <= 1000),
  reviewer text not null check (char_length(reviewer) between 1 and 120),
  reviewed_at timestamptz not null default now()
);

-- ---------- 4. Knowledge base: tags and version history ---------------------------

alter table public.ai_kb_entries add column if not exists tags text[] not null default '{}'
  check (cardinality(tags) <= 10);

create table if not exists public.ai_kb_entry_versions (
  seq bigint generated always as identity primary key,
  entry_id uuid not null references public.ai_kb_entries (id) on delete cascade,
  version int not null check (version >= 1),
  title text not null,
  body text not null,
  reliability_status text not null,
  official_source_url text,
  tags text[] not null default '{}',
  replaced_at timestamptz not null default now(),
  replaced_by text
);

-- A knowledge entry's previous content is kept whenever it changes, by the database itself.
-- Security definer: the trigger is the only writer of version rows, so it writes them whatever the caller's role.
create or replace function public.ai_kb_entry_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.title, old.body, old.reliability_status, old.official_source_url, old.tags) is distinct from
     (new.title, new.body, new.reliability_status, new.official_source_url, new.tags) then
    insert into public.ai_kb_entry_versions (entry_id, version, title, body, reliability_status, official_source_url, tags, replaced_by)
    values (old.id, old.version, old.title, old.body, old.reliability_status, old.official_source_url, old.tags, auth.uid()::text);
  end if;
  return new;
end $$;

drop trigger if exists ai_kb_entry_snapshot on public.ai_kb_entries;
create trigger ai_kb_entry_snapshot before update on public.ai_kb_entries
  for each row execute function public.ai_kb_entry_snapshot();

-- ---------- 5. Row-level security -------------------------------------------------

alter table public.ai_campaign_agents enable row level security;
alter table public.ai_campaign_content enable row level security;
alter table public.ai_campaign_spend enable row level security;
alter table public.ai_campaign_kpi_readings enable row level security;
alter table public.ai_campaign_events enable row level security;
alter table public.ai_content_reviews enable row level security;
alter table public.ai_kb_entry_versions enable row level security;

drop policy if exists ai_campaign_agents_rw on public.ai_campaign_agents;
create policy ai_campaign_agents_rw on public.ai_campaign_agents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_campaign_content_rw on public.ai_campaign_content;
create policy ai_campaign_content_rw on public.ai_campaign_content for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_campaign_spend_rw on public.ai_campaign_spend;
create policy ai_campaign_spend_rw on public.ai_campaign_spend for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_campaign_kpi_rw on public.ai_campaign_kpi_readings;
create policy ai_campaign_kpi_rw on public.ai_campaign_kpi_readings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- History: readable by administrators and the runner, insertable by administrators only. No update or delete.
drop policy if exists ai_campaign_events_read on public.ai_campaign_events;
create policy ai_campaign_events_read on public.ai_campaign_events for select to authenticated
  using (public.is_admin_or_operator());
drop policy if exists ai_campaign_events_insert on public.ai_campaign_events;
create policy ai_campaign_events_insert on public.ai_campaign_events for insert to authenticated
  with check (public.is_admin());

drop policy if exists ai_content_reviews_read on public.ai_content_reviews;
create policy ai_content_reviews_read on public.ai_content_reviews for select to authenticated
  using (public.is_admin_or_operator());
drop policy if exists ai_content_reviews_insert on public.ai_content_reviews;
create policy ai_content_reviews_insert on public.ai_content_reviews for insert to authenticated
  with check (public.is_admin());

drop policy if exists ai_kb_entry_versions_read on public.ai_kb_entry_versions;
create policy ai_kb_entry_versions_read on public.ai_kb_entry_versions for select to authenticated
  using (public.is_admin_or_operator());

revoke all on public.ai_campaign_events, public.ai_content_reviews, public.ai_kb_entry_versions from anon;
revoke update, delete, truncate on public.ai_campaign_events, public.ai_content_reviews, public.ai_kb_entry_versions from authenticated;
