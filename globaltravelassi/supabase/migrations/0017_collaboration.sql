-- 0017: multi-agent autonomy. Additive only. Not applied by the change that adds it.
--
-- ai_review_panels   : the consensus of two independent reviewers for each agent output. Append-only. Codes only.
-- ai_routing_decisions: why each routable step went to the agent it did. Append-only.
-- ai_conflicts       : claims that disagree between agents. The engine (operator or owner) records them; only the owner
--                      resolves them, once, and the resolution is kept.
-- The operator account (the scheduler) may insert panels, routing decisions and conflicts. It may not resolve conflicts.

create table if not exists public.ai_review_panels (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  run_id uuid not null references public.ai_workflow_runs (id) on delete cascade,
  producer text not null check (char_length(producer) between 2 and 60),
  attempt int not null check (attempt >= 1),
  status text not null check (status in ('PASSED', 'NEEDS_REVISION', 'REJECTED', 'REQUIRES_HUMAN_REVIEW')),
  decision text not null check (decision in ('approve', 'revise', 'reject', 'escalate_to_owner')),
  votes jsonb not null check (jsonb_typeof(votes) = 'array' and jsonb_array_length(votes) <= 5 and octet_length(votes::text) <= 4096),
  counted text[] not null default '{}',
  excluded jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded) = 'array' and jsonb_array_length(excluded) <= 10),
  reasons text[] not null default '{}',
  disagreement boolean not null,
  created_at timestamptz not null default now(),
  unique (task_id, attempt)
);

create table if not exists public.ai_routing_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_workflow_runs (id) on delete cascade,
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  step_key text not null check (char_length(step_key) between 1 and 60),
  capability text not null check (char_length(capability) between 1 and 60),
  template_agent text not null references public.ai_agents (key),
  chosen_agent text not null references public.ai_agents (key),
  reasons text[] not null default '{}',
  candidates int not null check (candidates >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_conflicts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_workflow_runs (id) on delete cascade,
  task_id uuid references public.ai_tasks (id) on delete set null,
  subject_key text not null check (char_length(subject_key) between 1 and 200),
  parties text[] not null check (cardinality(parties) between 2 and 8),
  codes text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution is null or char_length(resolution) between 3 and 500),
  resolved_by text check (resolved_by is null or char_length(resolved_by) <= 120),
  resolved_at timestamptz,
  detected_at timestamptz not null default now(),
  unique (run_id, subject_key),
  constraint ai_conflicts_resolution check (
    (status = 'open' and resolution is null and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);

create index if not exists ai_conflicts_status_idx on public.ai_conflicts (status, detected_at desc);
create index if not exists ai_review_panels_run_idx on public.ai_review_panels (run_id, created_at desc);
create index if not exists ai_routing_decisions_run_idx on public.ai_routing_decisions (run_id, created_at desc);

-- A conflict is resolved once. Nothing else about it can change after it is recorded.
create or replace function public.ai_conflict_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'resolved' then
    raise exception 'A resolved conflict cannot change.' using errcode = 'check_violation';
  end if;
  if new.run_id is distinct from old.run_id or new.task_id is distinct from old.task_id or new.subject_key is distinct from old.subject_key
     or new.parties is distinct from old.parties or new.codes is distinct from old.codes or new.detected_at is distinct from old.detected_at then
    raise exception 'Only the resolution of a conflict can change.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists ai_conflicts_guard on public.ai_conflicts;
create trigger ai_conflicts_guard before update on public.ai_conflicts
  for each row execute function public.ai_conflict_guard();

alter table public.ai_review_panels enable row level security;
alter table public.ai_routing_decisions enable row level security;
alter table public.ai_conflicts enable row level security;

drop policy if exists ai_review_panels_read on public.ai_review_panels;
create policy ai_review_panels_read on public.ai_review_panels for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_review_panels_insert on public.ai_review_panels;
create policy ai_review_panels_insert on public.ai_review_panels for insert to authenticated with check (public.is_admin_or_operator());

drop policy if exists ai_routing_decisions_read on public.ai_routing_decisions;
create policy ai_routing_decisions_read on public.ai_routing_decisions for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_routing_decisions_insert on public.ai_routing_decisions;
create policy ai_routing_decisions_insert on public.ai_routing_decisions for insert to authenticated with check (public.is_admin_or_operator());

drop policy if exists ai_conflicts_read on public.ai_conflicts;
create policy ai_conflicts_read on public.ai_conflicts for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_conflicts_insert on public.ai_conflicts;
create policy ai_conflicts_insert on public.ai_conflicts for insert to authenticated with check (public.is_admin_or_operator());
-- Only the owner resolves a conflict.
drop policy if exists ai_conflicts_resolve on public.ai_conflicts;
create policy ai_conflicts_resolve on public.ai_conflicts for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.ai_review_panels, public.ai_routing_decisions, public.ai_conflicts from anon;
revoke update, delete, truncate on public.ai_review_panels, public.ai_routing_decisions from authenticated;
revoke delete, truncate on public.ai_conflicts from authenticated;
-- Conflicts: the owner may change only the resolution fields. The trigger enforces the same rule for every role.
revoke update on public.ai_conflicts from authenticated;
grant update (status, resolution, resolved_by, resolved_at) on public.ai_conflicts to authenticated;

-- Every agent receives questions and answers addressed to it, as it already does for handoffs (see 0004).
insert into public.ai_event_subscriptions (subscriber, event_type)
select a.key, t.event_type from public.ai_agents a
cross join (values ('agent.question'), ('agent.answer')) as t(event_type)
on conflict do nothing;
