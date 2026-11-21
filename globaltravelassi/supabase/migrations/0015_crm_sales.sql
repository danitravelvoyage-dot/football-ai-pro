-- 0015: CRM and sales pipeline. Additive only. Not applied by the change that adds it: applying it needs owner approval.
--
-- Customer data stays with the owner. Only administrators can read or write these tables. The operator role
-- (the scheduler's account) has no access. Contact details are not copied here: a lead that came from an
-- application points to that application, and the CRM never holds emails or phone numbers.
--
-- Stage history and interaction history are append-only: no update or delete is granted to signed-in users.

-- ---------- 1. Leads ---------------------------------------------------------------

create table if not exists public.ai_leads (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 120),
  source text not null check (source in ('application', 'manual', 'campaign', 'referral', 'social')),
  application_id uuid references public.applications (id) on delete restrict,
  destination_country text check (destination_country is null or destination_country ~ '^[A-Z]{2}$'),
  nationality text check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  travel_date date,
  interest text not null default 'other' check (interest in ('visa', 'travel_booking', 'document_help', 'other')),
  stage text not null default 'new' check (stage in ('new', 'contacted', 'qualified', 'interested', 'converted', 'lost')),
  stage_reason text check (stage_reason is null or char_length(stage_reason) <= 300),
  archived_at timestamptz,
  created_by text not null check (char_length(created_by) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An application lead must point to its application. Every other lead must not.
  constraint ai_leads_application_link check ((source = 'application') = (application_id is not null))
);

create index if not exists ai_leads_stage_idx on public.ai_leads (stage);
create index if not exists ai_leads_created_idx on public.ai_leads (created_at desc);

drop trigger if exists ai_leads_updated_at on public.ai_leads;
create trigger ai_leads_updated_at before update on public.ai_leads
  for each row execute function public.set_updated_at();

-- ---------- 2. Stage history and stage guard ------------------------------------------

create table if not exists public.ai_lead_stage_history (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  lead_id uuid not null references public.ai_leads (id) on delete cascade,
  from_stage text not null check (from_stage in ('new', 'contacted', 'qualified', 'interested', 'converted', 'lost')),
  to_stage text not null check (to_stage in ('new', 'contacted', 'qualified', 'interested', 'converted', 'lost')),
  reason text check (reason is null or char_length(reason) <= 300),
  changed_by text not null check (char_length(changed_by) between 1 and 120),
  changed_at timestamptz not null default now()
);

create index if not exists ai_lead_stage_history_lead_idx on public.ai_lead_stage_history (lead_id, changed_at);

-- Only these stage moves exist. The same table is in the application's rules module (lib/ai/crm/rules.ts).
-- The guard runs inside the same transaction as the update, so a refused move leaves no history row behind.
-- Writing the history row is the guard's job, so it runs with the function owner's rights.
create or replace function public.ai_lead_stage_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    if (old.stage, new.stage) not in (
      ('new', 'contacted'), ('new', 'lost'),
      ('contacted', 'qualified'), ('contacted', 'interested'), ('contacted', 'lost'),
      ('qualified', 'interested'), ('qualified', 'converted'), ('qualified', 'lost'),
      ('interested', 'qualified'), ('interested', 'converted'), ('interested', 'lost'),
      ('lost', 'new')
    ) then
      raise exception 'Lead stage move from % to % is not allowed.', old.stage, new.stage using errcode = 'check_violation';
    end if;
    if new.stage = 'lost' and coalesce(char_length(new.stage_reason), 0) < 3 then
      raise exception 'A lost lead needs a reason.' using errcode = 'check_violation';
    end if;
    insert into public.ai_lead_stage_history (lead_id, from_stage, to_stage, reason, changed_by)
    values (old.id, old.stage, new.stage, new.stage_reason, coalesce(auth.uid()::text, 'system'));
  end if;
  return new;
end $$;

drop trigger if exists ai_leads_stage_guard on public.ai_leads;
create trigger ai_leads_stage_guard before update on public.ai_leads
  for each row execute function public.ai_lead_stage_guard();

-- ---------- 3. Interactions (append-only) ----------------------------------------------

create table if not exists public.ai_lead_interactions (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  lead_id uuid not null references public.ai_leads (id) on delete cascade,
  kind text not null check (kind in ('note', 'call', 'meeting', 'message_sent_by_owner', 'status_update')),
  summary text not null check (char_length(summary) between 3 and 1000),
  recorded_by text not null check (char_length(recorded_by) between 1 and 120),
  occurred_at timestamptz not null default now()
);

create index if not exists ai_lead_interactions_lead_idx on public.ai_lead_interactions (lead_id, occurred_at);

-- ---------- 4. Follow-ups: suggested by rules, decided by the owner ----------------------

create table if not exists public.ai_follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.ai_leads (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 80),
  priority text not null check (priority in ('high', 'normal', 'low')),
  status text not null default 'suggested' check (status in ('suggested', 'scheduled', 'done', 'dismissed')),
  due_at timestamptz not null,
  created_by text not null check (char_length(created_by) between 1 and 120),
  decided_by text check (decided_by is null or char_length(decided_by) <= 120),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open follow-up per lead. Proposing again is a no-op while one is still open.
create unique index if not exists ai_follow_ups_one_open on public.ai_follow_ups (lead_id)
  where status in ('suggested', 'scheduled');

drop trigger if exists ai_follow_ups_updated_at on public.ai_follow_ups;
create trigger ai_follow_ups_updated_at before update on public.ai_follow_ups
  for each row execute function public.set_updated_at();

-- ---------- 5. Row-level security -------------------------------------------------------

alter table public.ai_leads enable row level security;
alter table public.ai_lead_stage_history enable row level security;
alter table public.ai_lead_interactions enable row level security;
alter table public.ai_follow_ups enable row level security;

drop policy if exists ai_leads_admin on public.ai_leads;
create policy ai_leads_admin on public.ai_leads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_lead_stage_history_read on public.ai_lead_stage_history;
create policy ai_lead_stage_history_read on public.ai_lead_stage_history for select to authenticated
  using (public.is_admin());
drop policy if exists ai_lead_stage_history_insert on public.ai_lead_stage_history;
create policy ai_lead_stage_history_insert on public.ai_lead_stage_history for insert to authenticated
  with check (public.is_admin());

drop policy if exists ai_lead_interactions_read on public.ai_lead_interactions;
create policy ai_lead_interactions_read on public.ai_lead_interactions for select to authenticated
  using (public.is_admin());
drop policy if exists ai_lead_interactions_insert on public.ai_lead_interactions;
create policy ai_lead_interactions_insert on public.ai_lead_interactions for insert to authenticated
  with check (public.is_admin());

drop policy if exists ai_follow_ups_admin on public.ai_follow_ups;
create policy ai_follow_ups_admin on public.ai_follow_ups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.ai_leads, public.ai_lead_stage_history, public.ai_lead_interactions, public.ai_follow_ups from anon;
revoke delete, truncate on public.ai_leads, public.ai_follow_ups from authenticated;
revoke update, delete, truncate on public.ai_lead_stage_history, public.ai_lead_interactions from authenticated;
