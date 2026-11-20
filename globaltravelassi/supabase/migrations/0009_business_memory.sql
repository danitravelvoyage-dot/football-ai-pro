-- =====================================================================
-- 0009 — Business memory (additive). DO NOT RUN until the owner approves.
-- Owner decisions (versioned, append-only), experiments and their results (append-only).
-- Results are recorded only with a sample size and a source; no value is ever invented here.
-- =====================================================================

create table if not exists public.ai_owner_decisions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('approval', 'strategy', 'campaign', 'pricing', 'service', 'other')),
  subject_ref text not null check (char_length(subject_ref) between 1 and 120),
  decision text not null check (decision in ('approved', 'rejected', 'changed', 'retired')),
  reasoning text not null check (char_length(reasoning) between 1 and 1000),
  version int not null check (version >= 1),
  supersedes_id uuid references public.ai_owner_decisions (id),
  decided_by uuid not null references auth.users (id) on delete restrict,
  decided_at timestamptz not null default now(),
  unique (subject_type, subject_ref, version),
  check ((version = 1) = (supersedes_id is null))
);
create index if not exists ai_owner_decisions_subject_idx on public.ai_owner_decisions (subject_type, subject_ref, version);

create table if not exists public.ai_experiments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('campaign', 'content', 'sales')),
  name text not null check (char_length(name) between 2 and 120),
  hypothesis text not null check (char_length(hypothesis) between 5 and 500),
  status text not null default 'draft' check (status in ('draft', 'running', 'finished')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by text not null check (char_length(created_by) between 1 and 120),
  created_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create table if not exists public.ai_experiment_results (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.ai_experiments (id) on delete cascade,
  variant text not null check (char_length(variant) between 1 and 60),
  metric_key text not null check (metric_key in ('impressions', 'clicks', 'leads', 'applications', 'conversions', 'revenue', 'reply_rate')),
  value numeric(14, 4) not null check (value >= 0),
  sample_size int not null check (sample_size >= 0),
  source text not null check (source in ('aggregate', 'manual', 'import')),
  period text not null check (char_length(period) between 2 and 40),
  recorded_by text not null check (char_length(recorded_by) between 1 and 120),
  recorded_at timestamptz not null default now(),
  -- A result needs a sample. Nothing is recorded without evidence of how many people or events it covers.
  check (sample_size >= 1),
  check (metric_key not in ('impressions', 'clicks', 'leads', 'applications', 'conversions') or value = trunc(value)),
  check (metric_key <> 'reply_rate' or value <= 1)
);
create index if not exists ai_experiment_results_exp_idx on public.ai_experiment_results (experiment_id, variant, metric_key);

alter table public.ai_owner_decisions enable row level security;
alter table public.ai_experiments enable row level security;
alter table public.ai_experiment_results enable row level security;

-- Decisions: only the owner records them. The runner reads them, to ground recommendations.
drop policy if exists ai_owner_decisions_read on public.ai_owner_decisions;
create policy ai_owner_decisions_read on public.ai_owner_decisions for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_owner_decisions_owner_insert on public.ai_owner_decisions;
create policy ai_owner_decisions_owner_insert on public.ai_owner_decisions for insert to authenticated with check (public.is_admin());

-- Experiments: the owner and the runner create and update them, while they are still drafts or running.
drop policy if exists ai_experiments_rw on public.ai_experiments;
create policy ai_experiments_rw on public.ai_experiments for all to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());

-- Results: append-only, recorded by the owner or the runner.
drop policy if exists ai_experiment_results_read on public.ai_experiment_results;
create policy ai_experiment_results_read on public.ai_experiment_results for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_experiment_results_insert on public.ai_experiment_results;
create policy ai_experiment_results_insert on public.ai_experiment_results for insert to authenticated with check (public.is_admin_or_operator());

drop trigger if exists ai_owner_decisions_append_only on public.ai_owner_decisions;
create trigger ai_owner_decisions_append_only before update or delete on public.ai_owner_decisions
  for each row execute function public.ai_append_only();
drop trigger if exists ai_experiment_results_append_only on public.ai_experiment_results;
create trigger ai_experiment_results_append_only before update or delete on public.ai_experiment_results
  for each row execute function public.ai_append_only();

revoke all on public.ai_owner_decisions, public.ai_experiments, public.ai_experiment_results from anon;
