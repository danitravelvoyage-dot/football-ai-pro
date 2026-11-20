-- =====================================================================
-- 0004 — Event bus (additive). DO NOT RUN until the owner approves.
-- Persistent typed events, subscriptions, and per-subscriber deliveries with retry state.
-- Owner and runner only. Customers have no access.
-- =====================================================================

-- Events are immutable. The payload is limited in size, and its contents are validated by the application.
create table if not exists public.ai_domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(event_type) between 5 and 80 and event_type ~ '^[a-z]+(\.[a-z_]+)+$'),
  producer text not null check (char_length(producer) between 2 and 80),
  target text not null check (target = 'broadcast' or target ~ '^[A-Za-z]{3,40}$'),
  correlation_id uuid,
  hop_count int not null default 0 check (hop_count between 0 and 5),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 8192),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  occurred_at timestamptz not null default now()
);
create index if not exists ai_domain_events_type_idx on public.ai_domain_events (event_type, occurred_at desc);
create index if not exists ai_domain_events_target_idx on public.ai_domain_events (target, occurred_at desc);

-- Which agent (or the COO) wants which event type.
create table if not exists public.ai_event_subscriptions (
  subscriber text not null references public.ai_agents (key) on delete cascade,
  event_type text not null check (char_length(event_type) between 5 and 80 and event_type ~ '^[a-z]+(\.[a-z_]+)+$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (subscriber, event_type)
);

-- One row per recipient of one event. The unique pair makes delivery idempotent per subscriber.
create table if not exists public.ai_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ai_domain_events (id) on delete cascade,
  subscriber text not null references public.ai_agents (key) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'dead')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, subscriber),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index if not exists ai_event_deliveries_due_idx on public.ai_event_deliveries (next_attempt_at) where status = 'pending';

alter table public.ai_domain_events enable row level security;
alter table public.ai_event_subscriptions enable row level security;
alter table public.ai_event_deliveries enable row level security;

drop policy if exists ai_domain_events_read on public.ai_domain_events;
create policy ai_domain_events_read on public.ai_domain_events for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_domain_events_insert on public.ai_domain_events;
create policy ai_domain_events_insert on public.ai_domain_events for insert to authenticated with check (public.is_admin_or_operator());
-- No update or delete policy: events cannot be changed or removed. The trigger below also blocks the owner role.
create or replace function public.ai_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists ai_domain_events_append_only on public.ai_domain_events;
create trigger ai_domain_events_append_only before update or delete on public.ai_domain_events
  for each row execute function public.ai_append_only();

revoke all on public.ai_domain_events, public.ai_event_subscriptions, public.ai_event_deliveries from anon;

drop policy if exists ai_event_subscriptions_read on public.ai_event_subscriptions;
create policy ai_event_subscriptions_read on public.ai_event_subscriptions for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_event_subscriptions_admin on public.ai_event_subscriptions;
create policy ai_event_subscriptions_admin on public.ai_event_subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_event_deliveries_read on public.ai_event_deliveries;
create policy ai_event_deliveries_read on public.ai_event_deliveries for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_event_deliveries_insert on public.ai_event_deliveries;
create policy ai_event_deliveries_insert on public.ai_event_deliveries for insert to authenticated with check (public.is_admin_or_operator());
drop policy if exists ai_event_deliveries_update on public.ai_event_deliveries;
create policy ai_event_deliveries_update on public.ai_event_deliveries for update to authenticated using (public.is_admin_or_operator()) with check (public.is_admin_or_operator());
-- No delete policy.

-- A finished delivery (delivered or dead) can never change again, and its identity is fixed.
create or replace function public.ai_delivery_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('delivered', 'dead') then
    raise exception 'Delivery % is already %', old.id, old.status using errcode = '42501';
  end if;
  if new.event_id <> old.event_id or new.subscriber <> old.subscriber then
    raise exception 'Delivery identity cannot change' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists ai_delivery_guard on public.ai_event_deliveries;
create trigger ai_delivery_guard before update on public.ai_event_deliveries
  for each row execute function public.ai_delivery_guard();

-- Default subscriptions. The COO watches outcomes. Each agent receives its own ready tasks and handoffs.
insert into public.ai_event_subscriptions (subscriber, event_type) values
  ('COOAgent', 'workflow.started'),
  ('COOAgent', 'task.succeeded'),
  ('COOAgent', 'task.failed'),
  ('COOAgent', 'task.waiting_approval'),
  ('COOAgent', 'approval.decided')
on conflict (subscriber, event_type) do nothing;

insert into public.ai_event_subscriptions (subscriber, event_type)
select a.key, t.event_type
from public.ai_agents a
cross join (values ('task.ready'), ('agent.handoff')) as t(event_type)
on conflict (subscriber, event_type) do nothing;
