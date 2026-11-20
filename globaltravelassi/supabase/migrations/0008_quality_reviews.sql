-- =====================================================================
-- 0008 — Quality reviews (additive). DO NOT RUN until the owner approves.
-- One append-only row per review attempt, so the revision history is kept.
-- Stores codes and locations only, never the output text, so no content leaves through this table.
-- Reads: owner and runner. No update or delete.
-- =====================================================================

create table if not exists public.ai_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  run_id uuid not null references public.ai_workflow_runs (id) on delete cascade,
  agent text not null references public.ai_agents (key),
  attempt int not null check (attempt >= 1),
  status text not null check (status in ('PASSED', 'NEEDS_REVISION', 'REJECTED', 'REQUIRES_HUMAN_REVIEW')),
  overall int not null check (overall between 0 and 100),
  scores jsonb not null check (jsonb_typeof(scores) = 'object' and octet_length(scores::text) <= 2048),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array' and octet_length(issues::text) <= 65536),
  feedback jsonb not null default '[]'::jsonb check (jsonb_typeof(feedback) = 'array' and octet_length(feedback::text) <= 32768),
  created_at timestamptz not null default now(),
  unique (task_id, attempt)
);
create index if not exists ai_quality_reviews_task_idx on public.ai_quality_reviews (task_id, attempt);

alter table public.ai_quality_reviews enable row level security;

drop policy if exists ai_quality_reviews_read on public.ai_quality_reviews;
create policy ai_quality_reviews_read on public.ai_quality_reviews for select to authenticated using (public.is_admin_or_operator());
drop policy if exists ai_quality_reviews_insert on public.ai_quality_reviews;
create policy ai_quality_reviews_insert on public.ai_quality_reviews for insert to authenticated with check (public.is_admin_or_operator());
-- No update or delete policy. The append-only trigger from migration 0004 also blocks the owner role.

drop trigger if exists ai_quality_reviews_append_only on public.ai_quality_reviews;
create trigger ai_quality_reviews_append_only before update or delete on public.ai_quality_reviews
  for each row execute function public.ai_append_only();

revoke all on public.ai_quality_reviews from anon;
