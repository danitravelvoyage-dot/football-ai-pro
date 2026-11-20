-- =====================================================================
-- 0005 — Shared context with versioning (additive). DO NOT RUN until the owner approves.
-- Company, agent and workflow context. Every write creates an immutable history row.
-- Visibility: 'owner' rows are readable only by the owner. 'team' rows are readable by the runner.
-- The agent-to-agent isolation rules are enforced in the application and covered by tests.
-- =====================================================================

create table if not exists public.ai_context_entries (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('company', 'agent', 'workflow')),
  scope_key text not null check (char_length(scope_key) between 1 and 120),
  context_key text not null check (context_key ~ '^[a-z][a-z0-9_.]{1,79}$'),
  value jsonb not null check (octet_length(value::text) <= 16384),
  visibility text not null default 'owner' check (visibility in ('owner', 'team')),
  version int not null default 1 check (version >= 1),
  updated_by text not null check (char_length(updated_by) between 1 and 120),
  updated_at timestamptz not null default now(),
  unique (scope, scope_key, context_key),
  check (scope <> 'company' or scope_key = 'company')
);

create table if not exists public.ai_context_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.ai_context_entries (id) on delete cascade,
  version int not null check (version >= 1),
  value jsonb not null,
  changed_by text not null check (char_length(changed_by) between 1 and 120),
  reason text check (reason is null or char_length(reason) <= 300),
  changed_at timestamptz not null default now(),
  unique (entry_id, version)
);

alter table public.ai_context_entries enable row level security;
alter table public.ai_context_versions enable row level security;

-- Owner sees everything. The runner sees only 'team' rows.
drop policy if exists ai_context_entries_read on public.ai_context_entries;
create policy ai_context_entries_read on public.ai_context_entries for select to authenticated
  using (public.is_admin() or (visibility = 'team' and public.is_ai_operator()));
drop policy if exists ai_context_entries_owner_write on public.ai_context_entries;
create policy ai_context_entries_owner_write on public.ai_context_entries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- History follows its entry: you can read a version only if you can read the entry.
drop policy if exists ai_context_versions_read on public.ai_context_versions;
create policy ai_context_versions_read on public.ai_context_versions for select to authenticated
  using (exists (select 1 from public.ai_context_entries e where e.id = ai_context_versions.entry_id));

-- History is append-only (trigger from 0004). Writes go through ai_context_write, which runs as the definer.
drop trigger if exists ai_context_versions_append_only on public.ai_context_versions;
create trigger ai_context_versions_append_only before update or delete on public.ai_context_versions
  for each row execute function public.ai_append_only();

revoke all on public.ai_context_entries, public.ai_context_versions from anon;

-- Atomic, optimistic-concurrency write. Creates the entry at version 1 when expected version is 0.
-- Any other mismatch raises SQLSTATE 40001 so the application can report a conflict.
create or replace function public.ai_context_write(
  p_scope text,
  p_scope_key text,
  p_key text,
  p_value jsonb,
  p_expected_version int,
  p_visibility text,
  p_changed_by text,
  p_reason text default null
)
returns table (out_entry_id uuid, out_version int)
language plpgsql security definer set search_path = public as $$
declare
  existing_row public.ai_context_entries;
  target_id uuid;
  next_version int;
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- The runner (operator) writes on behalf of agents, so the function enforces the same rules as the application:
  -- only the owner writes company context, and agent context is team-visible unless the owner writes it.
  if p_scope = 'company' and not public.is_admin() then
    raise exception 'Only the owner writes company context' using errcode = '42501';
  end if;
  if p_scope = 'agent' and not public.is_admin() and p_visibility <> 'team' then
    raise exception 'Agent context written by the runner must be team-visible' using errcode = '42501';
  end if;

  select * into existing_row
  from public.ai_context_entries e
  where e.scope = p_scope and e.scope_key = p_scope_key and e.context_key = p_key
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception 'Context version conflict' using errcode = '40001';
    end if;
    insert into public.ai_context_entries (scope, scope_key, context_key, value, visibility, version, updated_by)
    values (p_scope, p_scope_key, p_key, p_value, p_visibility, 1, p_changed_by)
    returning id into target_id;
    next_version := 1;
  else
    if existing_row.version <> p_expected_version then
      raise exception 'Context version conflict' using errcode = '40001';
    end if;
    next_version := existing_row.version + 1;
    target_id := existing_row.id;
    update public.ai_context_entries e
    set value = p_value, visibility = p_visibility, version = next_version, updated_by = p_changed_by, updated_at = now()
    where e.id = target_id;
  end if;

  insert into public.ai_context_versions (entry_id, version, value, changed_by, reason)
  values (target_id, next_version, p_value, p_changed_by, p_reason);

  return query select target_id, next_version;
end $$;

revoke all on function public.ai_context_write(text, text, text, jsonb, int, text, text, text) from public, anon;
grant execute on function public.ai_context_write(text, text, text, jsonb, int, text, text, text) to authenticated;
