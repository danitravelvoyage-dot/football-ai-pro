-- =====================================================================
-- 0002 — AI company (additive only). DO NOT RUN until the owner approves.
-- Creates new ai_* tables, aggregate-only functions and an AI runner identity.
-- No existing table, column, policy, function or record is changed.
-- =====================================================================

-- ---------- 1. Identities ------------------------------------------------

create table if not exists public.ai_operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 80),
  created_at timestamptz not null default now()
);

-- The runner identity. It can create work and results, but cannot decide approvals.
create or replace function public.is_ai_operator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ai_operators o where o.user_id = auth.uid());
$$;

create or replace function public.is_admin_or_operator()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_ai_operator();
$$;

-- ---------- 2. Core tables -------------------------------------------------

create table if not exists public.ai_agents (
  key text primary key check (key in (
    'COOAgent','MarketResearchAgent','MarketingStrategistAgent','ContentCreatorAgent',
    'CreativeDirectorAgent','VideoProductionAgent','SocialMediaAgent','SEOAgent',
    'SalesAgent','CustomerSupportAgent','CRMAgent','VisaResearchAgent',
    'DataAnalystAgent','FinanceAgent','ComplianceAgent','WebsiteOperationsAgent')),
  name text not null check (char_length(name) between 2 and 120),
  enabled boolean not null default true,
  prompt_version text not null check (prompt_version ~ '^\d+\.\d+\.\d+$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null check (workflow_key in ('marketing','sales','support','visa','analytics')),
  objective text not null check (char_length(objective) between 3 and 2000),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 120),
  created_by text not null check (char_length(created_by) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_workflow_runs (id) on delete cascade,
  workflow_key text not null check (workflow_key in ('marketing','sales','support','visa','analytics')),
  step_key text not null check (char_length(step_key) between 2 and 60),
  agent text not null references public.ai_agents (key),
  title text not null check (char_length(title) between 2 and 160),
  status text not null default 'pending' check (status in (
    'pending','ready','running','waiting_approval','succeeded','failed','blocked','cancelled')),
  priority int not null default 5 check (priority between 0 and 10),
  due_at timestamptz,
  input jsonb not null,
  output jsonb,
  action_class text check (action_class is null or action_class in (
    'read_internal','write_draft','propose_change','external_publish','external_send_message',
    'external_payment','external_production_change','external_deploy','external_commitment')),
  requires_approval boolean not null default false,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  next_run_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_key)
);
create index if not exists ai_tasks_ready_idx on public.ai_tasks (status, next_run_at) where status = 'ready';

create table if not exists public.ai_task_dependencies (
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.ai_tasks (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table if not exists public.ai_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_tasks (id) on delete cascade,
  agent text not null references public.ai_agents (key),
  kind text not null check (char_length(kind) between 2 and 60),
  language text not null check (language in ('ar','fr','en')),
  country text not null check (country in ('dz','ma','tn','all')),
  body jsonb not null,
  status text not null check (status in ('draft','awaiting_owner','approved','rejected')),
  source text not null check (source in ('mock','live','deterministic')),
  prompt_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  artifact_id uuid references public.ai_artifacts (id) on delete set null,
  action_class text not null check (action_class in (
    'read_internal','write_draft','propose_change','external_publish','external_send_message',
    'external_payment','external_production_change','external_deploy','external_commitment')),
  risk_level text not null check (risk_level in ('low','medium','high')),
  summary text not null check (char_length(summary) between 2 and 500),
  preview jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check ((status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null))
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  agent text not null references public.ai_agents (key),
  attempt int not null check (attempt >= 0),
  prompt_version text not null,
  provider_id text,
  status text not null check (status in ('succeeded','failed')),
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  duration_ms int not null default 0 check (duration_ms >= 0),
  error text check (error is null or char_length(error) <= 2000),
  started_at timestamptz not null,
  finished_at timestamptz not null
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  from_agent text not null,
  to_agent text not null,
  type text not null check (type in ('task','result','question','handoff','report','alert')),
  payload jsonb not null default '{}'::jsonb,
  hop_count int not null default 0 check (hop_count between 0 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_memory (
  agent text not null references public.ai_agents (key),
  memory_key text not null check (char_length(memory_key) between 1 and 120),
  summary text not null check (char_length(summary) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (agent, memory_key)
);

create table if not exists public.ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  doc_key text not null check (char_length(doc_key) between 2 and 80),
  language text check (language is null or language in ('ar','fr','en')),
  country text check (country is null or country in ('dz','ma','tn','all')),
  content text not null check (char_length(content) <= 20000),
  version int not null default 1 check (version >= 1),
  owner_approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (doc_key, language, country, version)
);

create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor text not null check (char_length(actor) between 1 and 120),
  event_type text not null check (char_length(event_type) between 3 and 80),
  entity_type text not null check (char_length(entity_type) between 2 and 40),
  entity_id text not null check (char_length(entity_id) between 1 and 80),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists ai_events_ts_idx on public.ai_events (ts desc);

create table if not exists public.ai_usage (
  day date not null,
  provider_id text not null check (char_length(provider_id) between 1 and 40),
  requests int not null default 0 check (requests >= 0),
  tokens int not null default 0 check (tokens >= 0),
  primary key (day, provider_id)
);

create table if not exists public.ai_settings (
  key text primary key check (char_length(key) between 2 and 60),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  goal text not null check (char_length(goal) <= 500),
  country text check (country is null or country in ('dz','ma','tn','all')),
  language text check (language is null or language in ('ar','fr','en')),
  channel text not null check (char_length(channel) between 2 and 60),
  status text not null default 'draft' check (status in ('draft','active','paused','finished')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null check (char_length(metric_key) between 2 and 80),
  value numeric not null,
  period text not null check (char_length(period) between 2 and 40),
  source text not null check (source in ('aggregate','manual','import')),
  recorded_at timestamptz not null default now()
);

create table if not exists public.ai_sources_allowlist (
  host text primary key check (host = lower(host) and char_length(host) between 4 and 255),
  purpose text not null check (char_length(purpose) between 2 and 200),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now()
);

-- ---------- 3. Row-level security -----------------------------------------

alter table public.ai_operators enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_workflow_runs enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.ai_task_dependencies enable row level security;
alter table public.ai_artifacts enable row level security;
alter table public.ai_approvals enable row level security;
alter table public.ai_agent_runs enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_memory enable row level security;
alter table public.ai_knowledge enable row level security;
alter table public.ai_events enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_campaigns enable row level security;
alter table public.ai_metrics enable row level security;
alter table public.ai_sources_allowlist enable row level security;

-- Only the owner (admin) manages the operator list and settings.
drop policy if exists ai_operators_admin on public.ai_operators;
create policy ai_operators_admin on public.ai_operators for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_settings_admin on public.ai_settings;
create policy ai_settings_admin on public.ai_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_sources_admin on public.ai_sources_allowlist;
create policy ai_sources_admin on public.ai_sources_allowlist for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_knowledge_admin on public.ai_knowledge;
create policy ai_knowledge_admin on public.ai_knowledge for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Agents and the runner (admin or operator) can read and create work.
drop policy if exists ai_agents_read on public.ai_agents;
create policy ai_agents_read on public.ai_agents for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_agents_admin_write on public.ai_agents;
create policy ai_agents_admin_write on public.ai_agents for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_runs_rw on public.ai_workflow_runs;
create policy ai_runs_rw on public.ai_workflow_runs for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_tasks_rw on public.ai_tasks;
create policy ai_tasks_rw on public.ai_tasks for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_deps_rw on public.ai_task_dependencies;
create policy ai_deps_rw on public.ai_task_dependencies for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_artifacts_rw on public.ai_artifacts;
create policy ai_artifacts_rw on public.ai_artifacts for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_agent_runs_rw on public.ai_agent_runs;
create policy ai_agent_runs_rw on public.ai_agent_runs for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_messages_rw on public.ai_messages;
create policy ai_messages_rw on public.ai_messages for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_memory_rw on public.ai_memory;
create policy ai_memory_rw on public.ai_memory for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_usage_rw on public.ai_usage;
create policy ai_usage_rw on public.ai_usage for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_campaigns_rw on public.ai_campaigns;
create policy ai_campaigns_rw on public.ai_campaigns for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
drop policy if exists ai_metrics_rw on public.ai_metrics;
create policy ai_metrics_rw on public.ai_metrics for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());

-- Approvals: the runner may request (only as pending). Only the owner may decide.
drop policy if exists ai_approvals_read on public.ai_approvals;
create policy ai_approvals_read on public.ai_approvals for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_approvals_request on public.ai_approvals;
create policy ai_approvals_request on public.ai_approvals for insert to authenticated
  with check (public.is_admin() or (public.is_ai_operator() and status = 'pending'));
drop policy if exists ai_approvals_owner_decide on public.ai_approvals;
create policy ai_approvals_owner_decide on public.ai_approvals for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Events are append-only: no update or delete policy exists, so both are denied.
drop policy if exists ai_events_read on public.ai_events;
create policy ai_events_read on public.ai_events for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_events_insert on public.ai_events;
create policy ai_events_insert on public.ai_events for insert to authenticated with check (public.is_admin_or_operator());

-- Anonymous visitors get nothing from the AI tables.
revoke all on public.ai_operators, public.ai_agents, public.ai_workflow_runs, public.ai_tasks,
  public.ai_task_dependencies, public.ai_artifacts, public.ai_approvals, public.ai_agent_runs,
  public.ai_messages, public.ai_memory, public.ai_knowledge, public.ai_events, public.ai_usage,
  public.ai_settings, public.ai_campaigns, public.ai_metrics, public.ai_sources_allowlist from anon;

-- ---------- 4. Integrity triggers -----------------------------------------

-- A decided approval can never be changed again.
create or replace function public.ai_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'pending' then
    raise exception 'Approval % is already %', old.id, old.status using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists ai_approval_guard on public.ai_approvals;
create trigger ai_approval_guard before update on public.ai_approvals
  for each row execute function public.ai_approval_guard();

-- Every decision is written to the audit log by the database itself.
create or replace function public.ai_approval_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_events (actor, event_type, entity_type, entity_id, meta)
  values (
    'owner:' || coalesce(new.decided_by::text, 'unknown'),
    'approval.' || new.status,
    'approval',
    new.id::text,
    jsonb_build_object('action_class', new.action_class, 'task_id', new.task_id)
  );
  return new;
end $$;

drop trigger if exists ai_approval_audit on public.ai_approvals;
create trigger ai_approval_audit after update on public.ai_approvals
  for each row when (old.status is distinct from new.status)
  execute function public.ai_approval_audit();

-- ---------- 5. Queue claim (atomic, safe with several workers) ------------

create or replace function public.ai_claim_ready_tasks(p_limit int default 5)
returns setof public.ai_tasks
language plpgsql security definer set search_path = public as $$
declare
  claimed public.ai_tasks;
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  for claimed in
    update public.ai_tasks t
    set status = 'running', attempts = t.attempts + 1, updated_at = now()
    where t.id in (
      select q.id from public.ai_tasks q
      where q.status = 'ready' and q.next_run_at <= now()
      order by q.priority desc, q.created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    returning t.*
  loop
    return next claimed;
  end loop;
  return;
end $$;

-- ---------- 6. Aggregate-only views for agents ----------------------------
-- Counts only: no names, emails, phones, documents or free text.

create or replace function public.ai_requests_daily()
returns table (day date, service_id uuid, source text, status text, count int)
language sql stable security definer set search_path = public as $$
  select date_trunc('day', a.created_at)::date, a.service_id, coalesce(a.source, 'direct'), a.status, count(*)::int
  from public.applications a
  where public.is_admin_or_operator()
  group by 1, 2, 3, 4;
$$;

create or replace function public.ai_payments_daily()
returns table (day date, currency text, status text, amount numeric, count int)
language sql stable security definer set search_path = public as $$
  select date_trunc('day', p.created_at)::date, p.currency, p.status, sum(p.amount), count(*)::int
  from public.payments p
  where public.is_admin_or_operator()
  group by 1, 2, 3;
$$;

revoke all on function public.ai_requests_daily() from public, anon;
revoke all on function public.ai_payments_daily() from public, anon;
revoke all on function public.ai_claim_ready_tasks(int) from public, anon;
grant execute on function public.ai_requests_daily() to authenticated;
grant execute on function public.ai_payments_daily() to authenticated;
grant execute on function public.ai_claim_ready_tasks(int) to authenticated;
