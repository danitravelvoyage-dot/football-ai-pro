-- 0016: competitor intelligence (phase 1). Additive only. Not applied by the change that adds it.
--
-- Only public pages that the owner has registered are monitored. Each source records who reviewed the site's terms
-- and when. After registration the URL, host and terms record cannot be changed: a different page needs a new source.
-- Observations are append-only. Only administrators can read or write these tables.

create table if not exists public.ai_competitor_sources (
  id uuid primary key,
  name text not null check (char_length(name) between 2 and 120),
  url text not null check (url like 'https://%' and char_length(url) <= 600),
  host text not null check (host = lower(host) and char_length(host) between 4 and 255),
  kind text not null check (kind in ('pricing_page', 'offer_page', 'news_page')),
  purpose text not null check (char_length(purpose) between 3 and 200),
  terms_reviewed_by text not null check (char_length(terms_reviewed_by) between 1 and 120),
  terms_reviewed_at timestamptz not null,
  min_interval_hours int not null check (min_interval_hours between 6 and 720),
  active boolean not null default true,
  last_checked_at timestamptz,
  last_status text check (last_status is null or last_status in ('ok', 'fetch_failed', 'robots_disallowed', 'not_html', 'too_large', 'redirect_refused')),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_competitor_observations (
  seq bigint generated always as identity primary key,
  id uuid not null unique,
  source_id uuid not null references public.ai_competitor_sources (id) on delete restrict,
  observed_at timestamptz not null,
  status text not null check (status in ('ok', 'fetch_failed', 'robots_disallowed', 'not_html', 'too_large', 'redirect_refused')),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  offers jsonb not null default '[]'::jsonb check (jsonb_typeof(offers) = 'array' and jsonb_array_length(offers) <= 50),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) <= 100),
  constraint ai_competitor_observations_hash check ((status = 'ok') = (content_hash is not null))
);

create index if not exists ai_competitor_observations_source_idx on public.ai_competitor_observations (source_id, observed_at desc);

alter table public.ai_competitor_sources enable row level security;
alter table public.ai_competitor_observations enable row level security;

drop policy if exists ai_competitor_sources_admin on public.ai_competitor_sources;
create policy ai_competitor_sources_admin on public.ai_competitor_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_competitor_observations_read on public.ai_competitor_observations;
create policy ai_competitor_observations_read on public.ai_competitor_observations for select to authenticated
  using (public.is_admin());
drop policy if exists ai_competitor_observations_insert on public.ai_competitor_observations;
create policy ai_competitor_observations_insert on public.ai_competitor_observations for insert to authenticated
  with check (public.is_admin());

revoke all on public.ai_competitor_sources, public.ai_competitor_observations from anon;
-- Sources: the URL, host, kind, purpose and terms record are fixed once registered. Only the monitoring fields change.
revoke update, delete, truncate on public.ai_competitor_sources from authenticated;
grant update (active, last_checked_at, last_status) on public.ai_competitor_sources to authenticated;
-- Observations are history: no update, delete or truncate.
revoke update, delete, truncate on public.ai_competitor_observations from authenticated;
