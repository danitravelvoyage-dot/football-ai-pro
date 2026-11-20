-- 0012: owner notifications.
-- An inbox for the owner: task failures, scheduler problems and periodic summaries.
-- Additive only. Not applied to any database by the change that adds it: applying it needs owner approval.
--
-- Idempotency: each notice has a dedupe key, unique per notice. Writing the same notice twice keeps one row.
-- Writes come from the platform (administrator or operator session). Only the owner marks notices as read.

create table if not exists public.ai_owner_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 160),
  kind text not null check (kind in ('task_failed', 'scheduler_unhealthy', 'agent_summary')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  subject_ref text check (char_length(subject_ref) <= 120),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid references auth.users (id) on delete set null
);

create index if not exists ai_owner_notifications_inbox on public.ai_owner_notifications (read_at, created_at desc);

alter table public.ai_owner_notifications enable row level security;

drop policy if exists ai_owner_notifications_read on public.ai_owner_notifications;
create policy ai_owner_notifications_read on public.ai_owner_notifications for select to authenticated
  using (public.is_admin_or_operator());

drop policy if exists ai_owner_notifications_insert on public.ai_owner_notifications;
create policy ai_owner_notifications_insert on public.ai_owner_notifications for insert to authenticated
  with check (public.is_admin_or_operator() and read_at is null and read_by is null);

-- Only the owner marks a notice as read. The trigger stamps who and when, and a read cannot be undone.
create or replace function public.ai_owner_notification_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.read_at is not null then
    new.read_at := old.read_at;
    new.read_by := old.read_by;
  else
    new.read_at := now();
    new.read_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists ai_owner_notification_guard on public.ai_owner_notifications;
create trigger ai_owner_notification_guard
  before update on public.ai_owner_notifications
  for each row execute function public.ai_owner_notification_guard();

drop policy if exists ai_owner_notifications_owner_read on public.ai_owner_notifications;
create policy ai_owner_notifications_owner_read on public.ai_owner_notifications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.ai_owner_notifications from anon;
revoke update on public.ai_owner_notifications from authenticated;
grant update (read_at, read_by) on public.ai_owner_notifications to authenticated;
revoke delete, truncate, references, trigger on public.ai_owner_notifications from authenticated;
