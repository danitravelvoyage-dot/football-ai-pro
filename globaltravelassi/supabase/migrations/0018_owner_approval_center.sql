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
  kind text not null check (kind in ('held_answer', 'escalated_claim', 'crm_stage_disagreement', 'rejected_proposal', 'crm_transition', 'source_reactivation')),
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

-- Every decision is written to the append-only audit table by the database too, so a client cannot skip it.
create or replace function public.ai_review_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_events (actor, event_type, entity_type, entity_id, meta)
  values (
    'db:' || coalesce(auth.uid()::text, 'no-session'),
    'db.review.decided',
    'review_item',
    new.id::text,
    jsonb_build_object('kind', new.kind, 'previous_status', old.status, 'new_status', new.status, 'version', new.version, 'decided_by', new.decided_by)
  );
  return new;
end $$;

drop trigger if exists ai_review_items_audit on public.ai_review_items;
create trigger ai_review_items_audit after update on public.ai_review_items
  for each row execute function public.ai_review_audit();

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

-- ---------- 3. Source registry: owner-only writes, a reason on every change, no delete, audited ----------------

alter table public.ai_sources_allowlist add column if not exists category text not null default 'other'
  check (category in ('government', 'immigration', 'official_other', 'other'));
alter table public.ai_sources_allowlist add column if not exists jurisdiction text not null default 'all'
  check (jurisdiction in ('dz', 'ma', 'tn', 'fr', 'all'));
alter table public.ai_sources_allowlist add column if not exists status text not null default 'active';
alter table public.ai_sources_allowlist drop constraint if exists ai_sources_allowlist_status_check;
alter table public.ai_sources_allowlist add constraint ai_sources_allowlist_status_check check (status in ('active', 'disabled', 'retired'));
alter table public.ai_sources_allowlist add column if not exists expires_at timestamptz;
alter table public.ai_sources_allowlist add column if not exists validated_at timestamptz;
alter table public.ai_sources_allowlist add column if not exists updated_at timestamptz not null default now();
alter table public.ai_sources_allowlist add column if not exists version int not null default 1 check (version >= 1);
alter table public.ai_sources_allowlist add column if not exists last_change_reason text
  check (last_change_reason is null or char_length(last_change_reason) between 3 and 500);

-- Replaces the version-only trigger of the first draft. One guard decides every write to a source row.
drop trigger if exists ai_sources_allowlist_version on public.ai_sources_allowlist;
drop function if exists public.ai_source_version_bump();

create or replace function public.ai_source_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 then
      raise exception 'A new source starts at version 1.' using errcode = 'check_violation';
    end if;
  else
    -- Retirement is terminal. The only way out is the approved reactivation function, which sets the flag below.
    -- A row is never deleted: retirement keeps the host, its history and its approver.
    if old.status = 'retired' and new.status is distinct from 'active' then
      raise exception 'A retired source cannot change. Only an approved reactivation can bring it back.' using errcode = 'check_violation';
    end if;
    if old.status = 'retired' and new.status = 'active'
       and coalesce(current_setting('gta.source_reactivation', true), '') is distinct from old.host then
      raise exception 'A retired source can be reactivated only through an approved reactivation.' using errcode = 'check_violation';
    end if;
    if new.host is distinct from old.host or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      raise exception 'The host and the approver of a source cannot change.' using errcode = 'check_violation';
    end if;
    -- Each change carries its own reason: a stored reason from an earlier change does not count.
    if new.last_change_reason is not distinct from old.last_change_reason then
      raise exception 'Every source change needs its own reason. Give the reason for this change.' using errcode = 'check_violation';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  -- Every change, from every path, says why. The reason is kept on the row and written to the audit trail.
  if new.last_change_reason is null or char_length(new.last_change_reason) < 3 then
    raise exception 'Every source change needs a reason of 3 to 500 characters.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists ai_sources_allowlist_guard on public.ai_sources_allowlist;
create trigger ai_sources_allowlist_guard before insert or update on public.ai_sources_allowlist
  for each row execute function public.ai_source_guard();

create or replace function public.ai_source_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_events (actor, event_type, entity_type, entity_id, meta)
  values (
    'db:' || coalesce(auth.uid()::text, 'no-session'),
    case
      when tg_op = 'INSERT' then 'db.source.added'
      when old.status = 'retired' and new.status = 'active' then 'db.source.reactivated'
      when new.status = 'retired' then 'db.source.retired'
      when new.status = 'disabled' and old.status is distinct from 'disabled' then 'db.source.disabled'
      else 'db.source.changed'
    end,
    'ai_source',
    new.host,
    jsonb_build_object(
      'version', new.version,
      'status', new.status,
      'previous_status', case when tg_op = 'UPDATE' then old.status end,
      'previous_version', case when tg_op = 'UPDATE' then old.version end,
      'reason', new.last_change_reason
    )
  );
  return new;
end $$;

drop trigger if exists ai_sources_allowlist_audit on public.ai_sources_allowlist;
create trigger ai_sources_allowlist_audit after insert or update on public.ai_sources_allowlist
  for each row execute function public.ai_source_audit();

-- Owner-only writes. The broad "for all" policy from 0002 is replaced: no client role can delete a source.
drop policy if exists ai_sources_admin on public.ai_sources_allowlist;
drop policy if exists ai_sources_read on public.ai_sources_allowlist;
create policy ai_sources_read on public.ai_sources_allowlist for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_sources_owner_insert on public.ai_sources_allowlist;
create policy ai_sources_owner_insert on public.ai_sources_allowlist for insert to authenticated with check (public.is_admin());
drop policy if exists ai_sources_owner_update on public.ai_sources_allowlist;
create policy ai_sources_owner_update on public.ai_sources_allowlist for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke delete, truncate on public.ai_sources_allowlist from anon, authenticated;

-- The only way out of 'retired'. Owner only. Needs an approved source_reactivation item for this host, whose payload
-- names this exact version. Once used the row's version moves on, so the same approval cannot be used again.
create or replace function public.ai_reactivate_source(p_host text, p_expected_version int, p_reason text, p_review uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the owner can reactivate a source.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_reason, '')) < 3 or char_length(p_reason) > 500 then
    raise exception 'Every source change needs a reason of 3 to 500 characters.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.ai_review_items r
     where r.id = p_review
       and r.kind = 'source_reactivation'
       and r.status = 'approved'
       and r.subject_ref = p_host
       and (r.payload ->> 'version')::int = p_expected_version
  ) then
    raise exception 'No approved reactivation matches this source and version.' using errcode = 'check_violation';
  end if;
  perform set_config('gta.source_reactivation', p_host, true);
  update public.ai_sources_allowlist
     set status = 'active', last_change_reason = p_reason
   where host = p_host and version = p_expected_version and status = 'retired';
  if not found then
    raise exception 'The source changed. Reload and try again.' using errcode = 'check_violation';
  end if;
end $$;

revoke all on function public.ai_reactivate_source(text, int, text, uuid) from public, anon;
grant execute on function public.ai_reactivate_source(text, int, text, uuid) to authenticated;

-- ---------- 4. Audit integrity: client roles cannot change the audit trail; the owner can check that it holds -----------

-- The audit trail is append-only for client roles, by privilege as well as by trigger (the trigger is in 0010).
-- Insert stays: the application writes its events through the owner's session under RLS.
revoke update, delete, truncate on public.ai_events from anon, authenticated;

-- A read-only report of every integrity check. A database owner can disable a trigger; this report is how that shows.
create or replace function public.ai_audit_integrity_report()
returns table (check_name text, passed boolean, detail text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the owner can read the audit integrity report.' using errcode = '42501';
  end if;

  return query
  select 'ai_events_append_only_trigger'::text,
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_events' and t.tgname = 'ai_events_append_only' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Row trigger that refuses UPDATE and DELETE on ai_events (migration 0010)'::text
  union all
  select 'ai_events_no_truncate_trigger',
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_events' and t.tgname = 'ai_events_no_truncate' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Statement trigger that refuses TRUNCATE on ai_events (migration 0010)'
  union all
  select 'review_items_guard_trigger',
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_review_items' and t.tgname = 'ai_review_items_guard' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Decided review items cannot change (0018)'
  union all
  select 'review_items_audit_trigger',
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_review_items' and t.tgname = 'ai_review_items_audit' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Every review decision is written to ai_events by the database (0018)'
  union all
  select 'sources_guard_trigger',
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_sources_allowlist' and t.tgname = 'ai_sources_allowlist_guard' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Source rows need a reason per change, keep host and approver, and retire terminally (0018)'
  union all
  select 'sources_audit_trigger',
         exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'ai_sources_allowlist' and t.tgname = 'ai_sources_allowlist_audit' and not t.tgisinternal and t.tgenabled in ('O', 'A')),
         'Every source change is written to ai_events by the database (0018)'
  union all
  select 'ai_events_client_update_revoked',
         not has_table_privilege('authenticated', 'public.ai_events', 'UPDATE') and not has_table_privilege('anon', 'public.ai_events', 'UPDATE'),
         'API roles hold no UPDATE on ai_events'
  union all
  select 'ai_events_client_delete_revoked',
         not has_table_privilege('authenticated', 'public.ai_events', 'DELETE') and not has_table_privilege('anon', 'public.ai_events', 'DELETE'),
         'API roles hold no DELETE on ai_events'
  union all
  select 'review_items_client_delete_revoked',
         not has_table_privilege('authenticated', 'public.ai_review_items', 'DELETE') and not has_table_privilege('anon', 'public.ai_review_items', 'DELETE'),
         'API roles hold no DELETE on ai_review_items'
  union all
  select 'sources_client_delete_revoked',
         not has_table_privilege('authenticated', 'public.ai_sources_allowlist', 'DELETE') and not has_table_privilege('anon', 'public.ai_sources_allowlist', 'DELETE'),
         'API roles hold no DELETE on ai_sources_allowlist'
  union all
  select 'sources_broad_policy_gone',
         not exists (select 1 from pg_policies where tablename = 'ai_sources_allowlist' and policyname = 'ai_sources_admin'),
         'The broad "for all" policy from 0002 is replaced'
  union all
  select 'reactivation_function_present',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ai_reactivate_source'),
         'Retired hosts come back only through ai_reactivate_source (0018)';
end $$;

revoke all on function public.ai_audit_integrity_report() from public, anon;
grant execute on function public.ai_audit_integrity_report() to authenticated;
