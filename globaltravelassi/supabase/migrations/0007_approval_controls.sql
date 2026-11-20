-- =====================================================================
-- 0007 — Approval controls (additive; one widening of a check). DO NOT RUN until the owner approves.
-- Adds: expiry per action class, a payload fingerprint bound at creation, a one-time execution claim,
-- and server-side rules in the database: the owner decides, expired approvals cannot be approved,
-- and a bound payload cannot change.
-- Widening: the status check gains 'expired'. Every existing row remains valid.
-- =====================================================================

alter table public.ai_approvals add column if not exists expires_at timestamptz;
alter table public.ai_approvals add column if not exists payload_hash text
  check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$');
alter table public.ai_approvals add column if not exists executed_at timestamptz;

alter table public.ai_approvals drop constraint if exists ai_approvals_status_check;
alter table public.ai_approvals add constraint ai_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired'));

create index if not exists ai_approvals_expiry_idx on public.ai_approvals (expires_at) where status = 'pending';

-- Expiry window in hours per action class. Null means the action needs no approval.
-- The application keeps the same table (lib/ai/approvals/policy.ts); a test checks both agree.
create or replace function public.ai_approval_hours(p_action text)
returns int language sql immutable as $$
  select case p_action
    when 'external_production_change' then 4
    when 'external_payment' then 1
    when 'external_deploy' then 1
    when 'external_commitment' then 1
    when 'external_publish' then 24
    when 'external_send_message' then 24
    when 'propose_change' then 24
    else null
  end
$$;

-- Fingerprint of the exact action: class, task and payload. Any change to these changes the fingerprint.
create or replace function public.ai_approval_fingerprint(p_action text, p_task uuid, p_preview jsonb)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_action || '|' || p_task::text || '|' || p_preview::text, 'UTF8')), 'hex')
$$;

-- Sets the expiry and the fingerprint on creation. The application cannot supply either value.
create or replace function public.ai_approval_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hours int;
begin
  hours := public.ai_approval_hours(new.action_class);
  if hours is null then
    raise exception 'Action % does not need owner approval', new.action_class using errcode = '23514';
  end if;
  new.expires_at := now() + make_interval(hours => hours);
  new.payload_hash := public.ai_approval_fingerprint(new.action_class, new.task_id, new.preview);
  return new;
end $$;

drop trigger if exists ai_approval_prepare on public.ai_approvals;
create trigger ai_approval_prepare before insert on public.ai_approvals
  for each row execute function public.ai_approval_prepare();

-- Replaces the guard from 0002. Rules, all enforced here:
--  1. A decided approval cannot change, except the one-time execution claim by the owner.
--  2. A bound field (task, action, payload, fingerprint, expiry) never changes.
--  3. Only the owner approves or rejects.
--  4. An approval cannot be approved or rejected after it expires.
--  5. An approval can only be marked expired once its expiry time has passed.
--  6. An approval whose payload no longer matches its fingerprint cannot be approved.
create or replace function public.ai_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'pending' then
    if old.status = 'approved' and old.executed_at is null and new.executed_at is not null
       and public.is_admin()
       and new.status = old.status and new.task_id = old.task_id and new.action_class = old.action_class
       and new.preview = old.preview and new.payload_hash = old.payload_hash
       and new.expires_at is not distinct from old.expires_at
       and new.decided_at is not distinct from old.decided_at
       and new.decided_by is not distinct from old.decided_by
       and new.decision_note is not distinct from old.decision_note then
      return new;
    end if;
    raise exception 'Approval % is already %', old.id, old.status using errcode = '42501';
  end if;

  if new.task_id <> old.task_id or new.action_class <> old.action_class or new.preview <> old.preview
     or new.payload_hash is distinct from old.payload_hash or new.expires_at is distinct from old.expires_at then
    raise exception 'Approval % is bound to its payload and cannot change', old.id using errcode = '42501';
  end if;

  if new.status = 'expired' then
    if now() < old.expires_at then
      raise exception 'Approval % has not expired yet', old.id using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status in ('approved', 'rejected') then
    if not public.is_admin() then
      raise exception 'Only the owner can decide an approval' using errcode = '42501';
    end if;
    if now() >= old.expires_at then
      raise exception 'Approval % has expired', old.id using errcode = '42501';
    end if;
    if old.payload_hash <> public.ai_approval_fingerprint(old.action_class, old.task_id, old.preview) then
      raise exception 'Approval % no longer matches its payload', old.id using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Audit rows: expiry is written as the system, not as an owner.
create or replace function public.ai_approval_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_events (actor, event_type, entity_type, entity_id, meta)
  values (
    case when new.status = 'expired' then 'system' else 'owner:' || coalesce(new.decided_by::text, 'unknown') end,
    'approval.' || new.status,
    'approval',
    new.id::text,
    jsonb_build_object('action_class', new.action_class, 'task_id', new.task_id)
  );
  return new;
end $$;

-- The runner may expire approvals. The guard above still blocks every other change it could make.
drop policy if exists ai_approvals_runner_expire on public.ai_approvals;
create policy ai_approvals_runner_expire on public.ai_approvals for update to authenticated
  using (public.is_ai_operator()) with check (public.is_ai_operator());

-- Approvals that already exist get an expiry too, so no pending item can wait forever.
update public.ai_approvals
set expires_at = created_at + make_interval(hours => coalesce(public.ai_approval_hours(action_class), 24))
where status = 'pending' and expires_at is null;
