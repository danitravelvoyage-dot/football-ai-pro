-- 0011: autonomous scheduler.
-- A persistent job queue with leases, worker heartbeats and owner-controlled settings.
-- Additive only. Not applied to any database by the change that adds it: applying it needs owner approval.
--
-- Concurrency: leases are taken with `for update skip locked`, so two callers never receive the same job.
-- Fencing: a job can only be completed or failed by the owner that holds its lease.
-- Idempotency: a job key (one per epoch-aligned time slot) is unique, so a slot is queued once.
-- Time: every instant is timestamptz (UTC). The owner's timezone is validated against pg_timezone_names
-- and is used only for display.

-- ---------- 1. Owner-controlled settings (one row) -----------------------------

create table if not exists public.ai_scheduler_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  interval_minutes int not null default 5 check (interval_minutes between 1 and 1440),
  timezone text not null default 'Africa/Algiers' check (char_length(timezone) between 3 and 64),
  lease_seconds int not null default 300 check (lease_seconds between 60 and 3600),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.ai_scheduler_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.ai_scheduler_settings_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists ai_scheduler_settings_guard on public.ai_scheduler_settings;
create trigger ai_scheduler_settings_guard
  before insert or update on public.ai_scheduler_settings
  for each row execute function public.ai_scheduler_settings_guard();

-- ---------- 2. Persistent job queue -------------------------------------------

create table if not exists public.ai_scheduler_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique check (char_length(job_key) between 1 and 120),
  kind text not null check (kind in ('orchestrator_cycle')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  run_at timestamptz not null,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null check (max_attempts between 1 and 10),
  lease_owner text check (char_length(lease_owner) between 1 and 120),
  lease_expires_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (status <> 'running' or (lease_owner is not null and lease_expires_at is not null))
);

create index if not exists ai_scheduler_jobs_due on public.ai_scheduler_jobs (status, run_at);

-- ---------- 3. Worker heartbeats -----------------------------------------------

create table if not exists public.ai_worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 80),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_job_id uuid,
  last_outcome text check (char_length(last_outcome) <= 40)
);

-- ---------- 4. Row-level security ----------------------------------------------

alter table public.ai_scheduler_settings enable row level security;
alter table public.ai_scheduler_jobs enable row level security;
alter table public.ai_worker_heartbeats enable row level security;

drop policy if exists ai_scheduler_settings_read on public.ai_scheduler_settings;
create policy ai_scheduler_settings_read on public.ai_scheduler_settings for select to authenticated
  using (public.is_admin_or_operator());
drop policy if exists ai_scheduler_settings_owner_write on public.ai_scheduler_settings;
create policy ai_scheduler_settings_owner_write on public.ai_scheduler_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_scheduler_jobs_read on public.ai_scheduler_jobs;
create policy ai_scheduler_jobs_read on public.ai_scheduler_jobs for select to authenticated
  using (public.is_admin_or_operator());

drop policy if exists ai_worker_heartbeats_read on public.ai_worker_heartbeats;
create policy ai_worker_heartbeats_read on public.ai_worker_heartbeats for select to authenticated
  using (public.is_admin_or_operator());

-- Jobs and heartbeats change only through the functions below, never by a direct write.
revoke all on public.ai_scheduler_settings, public.ai_scheduler_jobs, public.ai_worker_heartbeats from anon;
revoke insert, update, delete on public.ai_scheduler_jobs, public.ai_worker_heartbeats from authenticated;
revoke insert, delete on public.ai_scheduler_settings from authenticated;
-- Row-level security does not apply to TRUNCATE, so it is revoked explicitly on every scheduler table.
revoke truncate, references, trigger on public.ai_scheduler_settings, public.ai_scheduler_jobs, public.ai_worker_heartbeats from authenticated;

-- ---------- 5. Functions the scheduler calls ------------------------------------

-- Queues a job for one time slot. A slot that already has a job is left alone. Nothing is queued while disabled.
create or replace function public.ai_scheduler_enqueue(p_job_key text, p_kind text, p_run_at timestamptz, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  s public.ai_scheduler_settings;
  inserted int;
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into s from public.ai_scheduler_settings where id = 1;
  if not found or not s.enabled then
    return false;
  end if;
  insert into public.ai_scheduler_jobs (id, job_key, kind, status, run_at, max_attempts)
  values (coalesce(p_id, gen_random_uuid()), p_job_key, p_kind, 'queued', p_run_at, s.max_attempts)
  on conflict (job_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted > 0;
end $$;

-- Leases due jobs and reclaims jobs whose lease lapsed. A job that lapsed after its last attempt is returned
-- with status 'dead' and is not leased. Returns at most p_limit leased jobs.
create or replace function public.ai_scheduler_lease(p_owner text, p_now timestamptz, p_lease_seconds int, p_limit int)
returns setof public.ai_scheduler_jobs language plpgsql security definer set search_path = public as $$
declare
  j public.ai_scheduler_jobs;
  cap int := greatest(1, least(coalesce(p_limit, 1), 10));
  taken int := 0;
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'Lease out of range' using errcode = '22023';
  end if;
  for j in
    select q.* from public.ai_scheduler_jobs q
    where (q.status = 'queued' and q.run_at <= p_now)
       or (q.status = 'running' and q.lease_expires_at <= p_now)
    order by q.run_at, q.created_at, q.id
    for update skip locked
  loop
    if j.status = 'running' and j.attempts >= j.max_attempts then
      update public.ai_scheduler_jobs
        set status = 'dead', lease_owner = null, lease_expires_at = null,
            last_error = 'Lease expired after the last allowed attempt.',
            finished_at = p_now, updated_at = p_now
        where id = j.id
        returning * into j;
      return next j;
      continue;
    end if;

    update public.ai_scheduler_jobs
      set status = 'running', lease_owner = p_owner,
          lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
          attempts = j.attempts + 1, updated_at = p_now
      where id = j.id
      returning * into j;
    return next j;
    taken := taken + 1;
    exit when taken >= cap;
  end loop;
  return;
end $$;

-- Marks a leased job succeeded. Returns false when the caller no longer holds the lease.
create or replace function public.ai_scheduler_complete(p_job uuid, p_owner text, p_now timestamptz, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.ai_scheduler_jobs
    set status = 'succeeded', result = p_result, last_error = null,
        lease_owner = null, lease_expires_at = null, finished_at = p_now, updated_at = p_now
    where id = p_job and status = 'running' and lease_owner = p_owner;
  return found;
end $$;

-- Re-queues a leased job after p_retry_at, or marks it dead when no attempts are left.
create or replace function public.ai_scheduler_fail(p_job uuid, p_owner text, p_now timestamptz, p_error text, p_retry_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  j public.ai_scheduler_jobs;
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into j from public.ai_scheduler_jobs
    where id = p_job and status = 'running' and lease_owner = p_owner
    for update;
  if not found then
    return 'lost';
  end if;
  if j.attempts >= j.max_attempts then
    update public.ai_scheduler_jobs
      set status = 'dead', last_error = left(p_error, 500),
          lease_owner = null, lease_expires_at = null, finished_at = p_now, updated_at = p_now
      where id = p_job;
    return 'dead';
  end if;
  update public.ai_scheduler_jobs
    set status = 'queued', run_at = p_retry_at, last_error = left(p_error, 500),
        lease_owner = null, lease_expires_at = null, updated_at = p_now
    where id = p_job;
  return 'queued';
end $$;

-- Records that a worker ran. One row per worker name, updated on every run.
create or replace function public.ai_worker_heartbeat(p_worker text, p_now timestamptz, p_job uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_or_operator() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.ai_worker_heartbeats (worker_id, started_at, last_seen_at, last_job_id, last_outcome)
  values (p_worker, p_now, p_now, p_job, p_outcome)
  on conflict (worker_id) do update
    set last_seen_at = excluded.last_seen_at,
        last_job_id = coalesce(excluded.last_job_id, public.ai_worker_heartbeats.last_job_id),
        last_outcome = excluded.last_outcome;
end $$;

revoke all on function public.ai_scheduler_settings_guard() from public, anon, authenticated;
revoke all on function public.ai_scheduler_enqueue(text, text, timestamptz, uuid) from public, anon;
revoke all on function public.ai_scheduler_lease(text, timestamptz, int, int) from public, anon;
revoke all on function public.ai_scheduler_complete(uuid, text, timestamptz, jsonb) from public, anon;
revoke all on function public.ai_scheduler_fail(uuid, text, timestamptz, text, timestamptz) from public, anon;
revoke all on function public.ai_worker_heartbeat(text, timestamptz, uuid, text) from public, anon;
grant execute on function public.ai_scheduler_enqueue(text, text, timestamptz, uuid) to authenticated;
grant execute on function public.ai_scheduler_lease(text, timestamptz, int, int) to authenticated;
grant execute on function public.ai_scheduler_complete(uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function public.ai_scheduler_fail(uuid, text, timestamptz, text, timestamptz) to authenticated;
grant execute on function public.ai_worker_heartbeat(text, timestamptz, uuid, text) to authenticated;
