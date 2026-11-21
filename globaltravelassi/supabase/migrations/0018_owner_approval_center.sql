-- 0018: owner control and approval center. Additive only. NOT applied: applying it needs the owner's approval.
--
-- ai_review_items   : every item held for the owner: held answers, escalated facts, CRM stage disagreements, rejected
--                     proposals and exceptional CRM transitions. An item is decided once; the decision is kept.
-- ai_leads.version  : optimistic concurrency. Every change bumps it; a change that names an old version is refused.
-- ai_sources_allowlist: now carries category, jurisdiction, status, expiry and validation dates (the host list stays).
-- Audit: decisions and source changes are written to ai_events, which is already append-only (migration 0010).

-- ---------- 1. Review items -------------------------------------------------------------

create table if not exists public.ai_review_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('held_answer', 'escalated_claim', 'crm_stage_disagreement', 'rejected_proposal', 'crm_transition')),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'revision_requested', 'expired')),
  agent text check (agent is null or char_length(agent) <= 60),
  run_id uuid references public.ai_workflow_runs (id) on delete cascade,
  task_id uuid references public.ai_tasks (id) on delete set null,
  lead_id uuid references public.ai_leads (id) on delete cascade,
  subject_ref text not null check (char_length(subject_ref) between 1 and 120),
  summary text not null check (char_length(summary) between 1 and 500),
  -- Evidence: source URLs, reason codes and the values being compared. Never customer personal data (guard in the app).
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by text check (decided_by is null or char_length(decided_by) <= 120),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  version int not null default 1,
  constraint ai_review_items_decided check (
    (status = 'open' and decided_by is null and decided_at is null)
    or (status <> 'open' and decided_by is not null and decided_at is not null)
  )
);
create index if not exists ai_review_items_status_idx on public.ai_review_items (status, created_at desc);
create index if not exists ai_review_items_lead_idx on public.ai_review_items (lead_id);

-- An item leaves 'open' once, and its identity and evidence never change afterwards.
create or replace function public.ai_review_item_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'open' then
    raise exception 'A decided review item cannot change.' using errcode = 'check_violation';
  end if;
  if new.kind is distinct from old.kind or new.subject_ref is distinct from old.subject_ref or new.evidence is distinct from old.evidence
     or new.payload is distinct from old.payload or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at
     or new.agent is distinct from old.agent or new.run_id is distinct from old.run_id or new.task_id is distinct from old.task_id
     or new.lead_id is distinct from old.lead_id then
    raise exception 'Only the decision of a review item can change.' using errcode = 'check_violation';
  end if;
  -- An open item moves once, to a decision. A decision is never 'open' again.
  if new.status not in ('approved', 'rejected', 'revision_requested', 'expired') then
    raise exception 'A review item can only move to a decision.' using errcode = 'check_violation';
  end if;
  -- Compare-and-set in the database too: the version rises by exactly one per decision.
  if new.version is distinct from old.version + 1 then
    raise exception 'Review item version must rise by one.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists ai_review_items_guard on public.ai_review_items;
create trigger ai_review_items_guard before update on public.ai_review_items
  for each row execute function public.ai_review_item_guard();

alter table public.ai_review_items enable row level security;
drop policy if exists ai_review_items_read on public.ai_review_items;
create policy ai_review_items_read on public.ai_review_items for select to authenticated using (public.is_admin());
drop policy if exists ai_review_items_insert on public.ai_review_items;
create policy ai_review_items_insert on public.ai_review_items for insert to authenticated with check (public.is_admin_or_operator());
-- Only the owner decides.
drop policy if exists ai_review_items_decide on public.ai_review_items;
create policy ai_review_items_decide on public.ai_review_items for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.ai_review_items from anon;
revoke delete, truncate on public.ai_review_items from authenticated;
revoke update on public.ai_review_items from authenticated;
grant update (status, decided_by, decided_at, decision_reason, version) on public.ai_review_items to authenticated;

-- ---------- 2. CRM concurrency: a version on every lead -----------------------------------

alter table public.ai_leads add column if not exists version int not null default 1 check (version >= 1);

create or replace function public.ai_lead_version_bump()
returns trigger language plpgsql set search_path = public as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

drop trigger if exists ai_leads_version on public.ai_leads;
create trigger ai_leads_version before update on public.ai_leads
  for each row execute function public.ai_lead_version_bump();

-- ---------- 3. Source registry: the existing host list gains its metadata ----------------------

alter table public.ai_sources_allowlist add column if not exists category text not null default 'other'
  check (category in ('government', 'immigration', 'official_other', 'other'));
alter table public.ai_sources_allowlist add column if not exists jurisdiction text not null default 'all'
  check (jurisdiction in ('dz', 'ma', 'tn', 'fr', 'all'));
alter table public.ai_sources_allowlist add column if not exists status text not null default 'active'
  check (status in ('active', 'disabled'));
alter table public.ai_sources_allowlist add column if not exists expires_at timestamptz;
alter table public.ai_sources_allowlist add column if not exists validated_at timestamptz;
alter table public.ai_sources_allowlist add column if not exists updated_at timestamptz not null default now();
alter table public.ai_sources_allowlist add column if not exists version int not null default 1 check (version >= 1);

-- Every change to a registry row bumps its version; a change that names an old version matches nothing.
create or replace function public.ai_source_version_bump()
returns trigger language plpgsql set search_path = public as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ai_sources_allowlist_version on public.ai_sources_allowlist;
create trigger ai_sources_allowlist_version before update on public.ai_sources_allowlist
  for each row execute function public.ai_source_version_bump();
