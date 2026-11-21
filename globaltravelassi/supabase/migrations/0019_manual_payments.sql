-- 0019: manual payments. Additive. NOT applied: applying it needs the owner's approval.
--
-- Depends only on the base schema (0001): applications, services, payments, application_events, the private bucket
-- and is_admin(). It does not depend on the AI migrations.
--
-- Write rule: no client role can insert, update or delete payments, application events or method settings. Every
-- write is made by a function in this file, which verifies the owner with is_admin() (profile role admin, active).
-- Authorization never rests on a session flag: the guards below refuse what the functions must never do.
--
-- Reads: customers read their payments and timeline through views with safe columns. The owner reads the base tables.
--
-- Irreversible on a live project: the status constraints and the payment columns are replaced, and rows already holding
-- 0019 states (pending_review, rejected, payment_pending, usdt, redotpay) cannot be restored to the 0001 rules. See the
-- rollback procedure in docs/migrations/0019_rollback.sql, which refuses to run while such rows exist.

-- ---------- 1. Request status: PAYMENT_PENDING ---------------------------------------------------------------------

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (
  status in ('new', 'in_review', 'documents_required', 'submitted', 'approved', 'rejected', 'completed', 'cancelled', 'payment_pending')
);

-- ---------- 2. Payments: self-service methods, proof and the owner's decision -------------------------------------

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (
  method in ('cash', 'bank_transfer', 'ccp', 'baridimob', 'other', 'usdt', 'redotpay')
);

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (
  status in ('pending', 'received', 'cancelled', 'pending_review', 'rejected')
);

alter table public.payments add column if not exists evidence_path text
  check (evidence_path is null or char_length(evidence_path) between 3 and 300);
alter table public.payments add column if not exists evidence_mime text
  check (evidence_mime is null or evidence_mime in ('application/pdf', 'image/jpeg', 'image/png'));
alter table public.payments add column if not exists evidence_size integer
  check (evidence_size is null or evidence_size between 1 and 10485760);
alter table public.payments add column if not exists submitted_at timestamptz;
alter table public.payments add column if not exists submitted_by uuid references public.profiles (id) on delete set null;
alter table public.payments add column if not exists verified_by uuid references public.profiles (id) on delete set null;
alter table public.payments add column if not exists verified_at timestamptz;
-- Internal: the owner's reason. Never shown to the customer.
alter table public.payments add column if not exists decision_reason text
  check (decision_reason is null or char_length(decision_reason) between 3 and 500);
-- The only decision text a customer sees: the message the owner writes for a rejected proof.
alter table public.payments add column if not exists customer_visible_rejection_message text
  check (customer_visible_rejection_message is null or char_length(customer_visible_rejection_message) between 3 and 500);

alter table public.payments drop constraint if exists payments_evidence_complete;
alter table public.payments add constraint payments_evidence_complete check (
  evidence_path is null or (evidence_mime is not null and evidence_size is not null and submitted_at is not null and submitted_by is not null)
);

alter table public.payments drop constraint if exists payments_pending_review_has_evidence;
alter table public.payments add constraint payments_pending_review_has_evidence check (
  status <> 'pending_review' or evidence_path is not null
);

alter table public.payments drop constraint if exists payments_decided_has_owner;
alter table public.payments add constraint payments_decided_has_owner check (
  evidence_path is null or status = 'pending_review' or (verified_by is not null and verified_at is not null)
);

alter table public.payments drop constraint if exists payments_rejected_has_message;
alter table public.payments add constraint payments_rejected_has_message check (
  status <> 'rejected' or customer_visible_rejection_message is not null
);

-- One open proof per request, whatever the caller does.
create unique index if not exists payments_one_open_review on public.payments (application_id) where status = 'pending_review';

-- ---------- 3. Guards on payments: the database refuses what the functions must never do ---------------------------

-- A proof-bearing payment: its proof and amount never change; a decided payment is final; the only status move is
-- pending_review to received or rejected. No flag decides this: it is a fixed rule for the row.
create or replace function public.payment_guard()
returns trigger language plpgsql as $$
begin
  if old.evidence_path is not null then
    if new.id is distinct from old.id or new.application_id is distinct from old.application_id
       or new.amount is distinct from old.amount or new.currency is distinct from old.currency or new.method is distinct from old.method
       or new.evidence_path is distinct from old.evidence_path or new.evidence_mime is distinct from old.evidence_mime
       or new.evidence_size is distinct from old.evidence_size or new.submitted_at is distinct from old.submitted_at
       or new.submitted_by is distinct from old.submitted_by then
      raise exception 'The proof and the amount of a payment cannot change.' using errcode = 'check_violation';
    end if;
    if old.status in ('received', 'rejected') and (
         new.status is distinct from old.status or new.verified_by is distinct from old.verified_by
         or new.verified_at is distinct from old.verified_at or new.decision_reason is distinct from old.decision_reason
         or new.customer_visible_rejection_message is distinct from old.customer_visible_rejection_message) then
      raise exception 'A decided payment cannot change.' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status and not (old.status = 'pending_review' and new.status in ('received', 'rejected')) then
      raise exception 'A payment with a proof changes only through the owner''s decision.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before update on public.payments
  for each row execute function public.payment_guard();

-- A proof-bearing payment is never deleted: its record is the evidence of what was paid.
create or replace function public.payment_no_delete_with_proof()
returns trigger language plpgsql as $$
begin
  if old.evidence_path is not null then
    raise exception 'A payment with a proof cannot be deleted. Its record is kept.' using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists payments_no_delete_with_proof on public.payments;
create trigger payments_no_delete_with_proof before delete on public.payments
  for each row execute function public.payment_no_delete_with_proof();

-- Insert protection: a payment is created as a proof awaiting review, or as an owner-recorded payment with no proof.
-- A row that arrives already decided, or with a proof that is not awaiting review, is refused.
create or replace function public.payment_insert_guard()
returns trigger language plpgsql as $$
begin
  if new.verified_by is not null or new.verified_at is not null or new.decision_reason is not null
     or new.customer_visible_rejection_message is not null then
    raise exception 'A payment cannot be created already decided.' using errcode = 'check_violation';
  end if;
  if new.evidence_path is not null and new.status <> 'pending_review' then
    raise exception 'A payment with a proof is created awaiting review.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists payments_insert_guard on public.payments;
create trigger payments_insert_guard before insert on public.payments
  for each row execute function public.payment_insert_guard();

-- ---------- 4. Privileges and policies: no client writes; owner-only reads of the base tables ------------------------

-- The owner's writes go through the functions. The 0001 write policy (for all, admin) is removed.
drop policy if exists payments_admin_write on public.payments;
revoke insert, update, delete, truncate on public.payments from authenticated;
revoke all on public.payments from anon;

-- The base table is readable by the owner only. Customers have no row policy on it at all.
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (public.is_admin());

-- verified_by, decision_reason, evidence_path, note, created_by and submitted_by are not in this view.
create or replace view public.customer_payments as
  select p.id, p.application_id, p.amount, p.currency, p.method, p.status, p.reference, p.received_at, p.created_at,
         p.submitted_at, p.customer_visible_rejection_message
    from public.payments p
    join public.applications a on a.id = p.application_id
   where a.user_id = auth.uid();

revoke all on public.customer_payments from anon, public;
grant select on public.customer_payments to authenticated;

-- Timeline: the owner reads every event; a customer reads a view without the internal actor.
drop policy if exists events_read on public.application_events;
drop policy if exists events_admin_read on public.application_events;
create policy events_admin_read on public.application_events for select to authenticated using (public.is_admin());
revoke update, delete, truncate on public.application_events from authenticated;

create or replace view public.customer_application_events as
  select e.id, e.application_id, e.kind, e.to_status, e.message, e.created_at
    from public.application_events e
    join public.applications a on a.id = e.application_id
   where a.user_id = auth.uid();

revoke all on public.customer_application_events from anon, public;
grant select on public.customer_application_events to authenticated;

-- ---------- 5. Payment method settings, and their history -------------------------------------------------------------

create table if not exists public.payment_method_settings (
  method text primary key check (method in ('usdt', 'baridimob', 'redotpay')),
  enabled boolean not null default false,
  instructions_fr text not null default '' check (char_length(instructions_fr) <= 2000),
  instructions_en text not null default '' check (char_length(instructions_en) <= 2000),
  instructions_ar text not null default '' check (char_length(instructions_ar) <= 2000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.payment_method_settings (method, enabled) values ('usdt', false), ('baridimob', false), ('redotpay', false)
  on conflict (method) do nothing;

alter table public.payment_method_settings enable row level security;
drop policy if exists payment_settings_read on public.payment_method_settings;
create policy payment_settings_read on public.payment_method_settings for select to authenticated using (true);
revoke all on public.payment_method_settings from anon;
revoke insert, update, delete, truncate on public.payment_method_settings from authenticated;

-- Every change keeps the settings before and after, the owner, the time and the reason. Append-only.
create table if not exists public.payment_method_history (
  id uuid primary key default gen_random_uuid(),
  method text not null references public.payment_method_settings (method) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text not null check (char_length(reason) between 3 and 500),
  previous jsonb not null check (jsonb_typeof(previous) = 'object'),
  next jsonb not null check (jsonb_typeof(next) = 'object')
);
create index if not exists payment_method_history_idx on public.payment_method_history (method, changed_at);

-- ---------- 6. Payment audit and proof removals ---------------------------------------------------------------------

create table if not exists public.payment_audit (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments (id) on delete restrict,
  application_id uuid references public.applications (id) on delete restrict,
  method text,
  action text not null check (action in ('submitted', 'approved', 'rejected', 'method_changed', 'orphan_purged')),
  from_status text,
  to_status text,
  actor_id uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  check (payment_id is not null or method is not null or application_id is not null)
);
create index if not exists payment_audit_payment_idx on public.payment_audit (payment_id, created_at);

-- A removal is recorded as an intent before the file is touched, and its result is recorded afterwards.
create table if not exists public.proof_removals (
  id uuid primary key default gen_random_uuid(),
  object_name text not null check (char_length(object_name) between 3 and 300),
  application_id uuid references public.applications (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'intent' check (status in ('intent', 'removed', 'failed')),
  detail text check (detail is null or char_length(detail) <= 300),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  check (status = 'intent' or finished_at is not null)
);
create unique index if not exists proof_removals_one_open on public.proof_removals (object_name) where status = 'intent';

-- Append-only: nothing is deleted; a removal only moves from intent to its result, and its identity never changes.
create or replace function public.append_only_guard()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'proof_removals' and tg_op = 'UPDATE' then
    if old.status = 'intent' and new.status in ('removed', 'failed')
       and new.object_name = old.object_name and new.application_id is not distinct from old.application_id
       and new.actor_id is not distinct from old.actor_id and new.reason = old.reason and new.requested_at = old.requested_at then
      return new;
    end if;
    raise exception 'A proof removal can only record its result once.' using errcode = 'check_violation';
  end if;
  raise exception 'The % table is append-only.', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists payment_audit_no_change on public.payment_audit;
create trigger payment_audit_no_change before update or delete on public.payment_audit
  for each row execute function public.append_only_guard();
drop trigger if exists payment_audit_no_truncate on public.payment_audit;
create trigger payment_audit_no_truncate before truncate on public.payment_audit
  for each statement execute function public.append_only_guard();
drop trigger if exists payment_history_no_change on public.payment_method_history;
create trigger payment_history_no_change before update or delete on public.payment_method_history
  for each row execute function public.append_only_guard();
drop trigger if exists payment_history_no_truncate on public.payment_method_history;
create trigger payment_history_no_truncate before truncate on public.payment_method_history
  for each statement execute function public.append_only_guard();
drop trigger if exists proof_removals_guard on public.proof_removals;
create trigger proof_removals_guard before update or delete on public.proof_removals
  for each row execute function public.append_only_guard();
drop trigger if exists proof_removals_no_truncate on public.proof_removals;
create trigger proof_removals_no_truncate before truncate on public.proof_removals
  for each statement execute function public.append_only_guard();

alter table public.payment_audit enable row level security;
drop policy if exists payment_audit_read on public.payment_audit;
create policy payment_audit_read on public.payment_audit for select to authenticated using (public.is_admin());
alter table public.payment_method_history enable row level security;
drop policy if exists payment_history_read on public.payment_method_history;
create policy payment_history_read on public.payment_method_history for select to authenticated using (public.is_admin());
alter table public.proof_removals enable row level security;
drop policy if exists proof_removals_read on public.proof_removals;
create policy proof_removals_read on public.proof_removals for select to authenticated using (public.is_admin());
revoke all on public.payment_audit, public.payment_method_history, public.proof_removals from anon;
revoke insert, update, delete, truncate on public.payment_audit, public.payment_method_history, public.proof_removals from authenticated;

-- ---------- 7. Functions: the only write paths. Each one verifies the owner or the customer itself -------------------

-- Storage reference check. Definer rights, because a customer cannot see the owner's payment rows. It answers only for
-- the caller's own folder (or for the owner), so a customer learns nothing about another customer's files.
create or replace function public.proof_is_referenced(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
           when public.is_admin() or split_part(p_name, '/', 1) = auth.uid()::text
             then exists (select 1 from public.payments p where p.evidence_path = p_name)
           else false
         end;
$$;
revoke all on function public.proof_is_referenced(text) from public, anon;
grant execute on function public.proof_is_referenced(text) to authenticated;

drop policy if exists "docs_owner_or_admin_delete" on storage.objects;
create policy "docs_owner_or_admin_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'customer-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
    and not public.proof_is_referenced(storage.objects.name)
  );

-- Customer: attach a proof to an open request. The amount comes from the service. The proof must be in the customer's
-- request folder, named as a payment proof, already uploaded, and not being removed. Serialized with removals per file.
create or replace function public.submit_payment_evidence(
  p_application uuid, p_method text, p_storage_path text, p_mime text, p_size integer, p_file_name text
) returns uuid language plpgsql security definer set search_path = public, storage as $$
declare
  uid uuid := auth.uid();
  app public.applications%rowtype;
  svc record;
  new_id uuid;
  folder text;
begin
  if uid is null then
    raise exception 'Sign in to submit a payment.' using errcode = '42501';
  end if;
  if p_storage_path is null then
    raise exception 'The proof must be in your own request folder, as a payment proof.' using errcode = 'check_violation';
  end if;
  -- Same lock as the removal of this file: a proof cannot be submitted while it is being removed, nor removed while it
  -- is being submitted. The lock is released at commit, when the reference is visible to the other side.
  perform pg_advisory_xact_lock(hashtext(p_storage_path));

  select * into app from public.applications where id = p_application and user_id = uid for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if app.status not in ('approved', 'payment_pending') then
    raise exception 'This request is not open for payment.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payments p where p.application_id = p_application and p.status = 'received') then
    raise exception 'This request is already paid.' using errcode = 'check_violation';
  end if;
  select s.price, s.currency into svc from public.services s where s.id = app.service_id;
  if svc.price is null or svc.price <= 0 then
    raise exception 'This service has no price yet.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.payment_method_settings m where m.method = p_method and m.enabled) then
    raise exception 'This payment method is not available.' using errcode = 'check_violation';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png') or p_size is null or p_size < 1 or p_size > 10485760 then
    raise exception 'Upload a PDF, JPEG or PNG up to 10 MB.' using errcode = 'check_violation';
  end if;
  folder := uid::text || '/' || p_application::text || '/';
  if left(p_storage_path, char_length(folder)) <> folder or left(p_storage_path, char_length(folder) + 8) <> folder || 'payment-' then
    raise exception 'The proof must be in your own request folder, as a payment proof.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.proof_removals r where r.object_name = p_storage_path and r.status = 'intent') then
    raise exception 'This proof is being removed. Upload a new one.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'customer-documents' and o.name = p_storage_path) then
    raise exception 'The proof file was not uploaded.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payments p where p.application_id = p_application and p.status = 'pending_review') then
    raise exception 'A payment is already waiting for review.' using errcode = 'check_violation';
  end if;

  insert into public.payments (application_id, amount, currency, method, status, reference, note, created_by,
                               evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
  values (p_application, svc.price, svc.currency, p_method, 'pending_review', left(coalesce(p_file_name, ''), 100), '', uid,
          p_storage_path, p_mime, p_size, now(), uid)
  returning id into new_id;

  update public.applications set status = 'payment_pending' where id = p_application and status = 'approved';
  insert into public.application_events (application_id, kind, to_status, message, actor_id)
  values (p_application, 'payment', 'payment_pending', 'Payment proof submitted', uid);
  insert into public.payment_audit (payment_id, application_id, method, action, from_status, to_status, actor_id, reason)
  values (new_id, p_application, p_method, 'submitted', null, 'pending_review', uid, 'Customer submitted a payment proof');
  return new_id;
end $$;

-- Owner: confirm funds actually received, or reject the proof. A rejection needs the message the customer will read.
-- Row lock: a second decision waits, then finds the payment already decided.
create or replace function public.decide_payment(p_payment uuid, p_decision text, p_reason text, p_customer_message text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.payments%rowtype;
  new_status text;
  why text := trim(coalesce(p_reason, ''));
  customer_msg text := nullif(trim(coalesce(p_customer_message, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only the owner can decide a payment.' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Unknown decision.' using errcode = 'check_violation';
  end if;
  if char_length(why) < 3 or char_length(why) > 500 then
    raise exception 'Give a reason of 3 to 500 characters.' using errcode = 'check_violation';
  end if;
  if p_decision = 'reject' and (customer_msg is null or char_length(customer_msg) < 3 or char_length(customer_msg) > 500) then
    raise exception 'Give the customer a message of 3 to 500 characters for a rejected proof.' using errcode = 'check_violation';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if p.status <> 'pending_review' then
    raise exception 'This payment was already decided.' using errcode = 'check_violation';
  end if;

  new_status := case when p_decision = 'approve' then 'received' else 'rejected' end;
  update public.payments
     set status = new_status,
         received_at = case when new_status = 'received' then now() else null end,
         verified_by = uid,
         verified_at = now(),
         decision_reason = why,
         customer_visible_rejection_message = case when new_status = 'rejected' then customer_msg else null end
   where id = p_payment;

  update public.applications set status = 'approved' where id = p.application_id and status = 'payment_pending';
  insert into public.application_events (application_id, kind, to_status, message, actor_id)
  values (p.application_id, 'payment', new_status, case when new_status = 'rejected' then customer_msg else 'Payment confirmed' end, uid);
  insert into public.payment_audit (payment_id, application_id, method, action, from_status, to_status, actor_id, reason)
  values (p_payment, p.application_id, p.method, case when new_status = 'received' then 'approved' else 'rejected' end,
          'pending_review', new_status, uid, why);
  return new_status;
end $$;

-- Owner: change whether a method is offered, and its instructions in each language. The previous state is kept.
create or replace function public.save_payment_method(
  p_method text, p_enabled boolean, p_fr text, p_en text, p_ar text, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  cur public.payment_method_settings%rowtype;
  why text := trim(coalesce(p_reason, ''));
  before_state jsonb;
  after_state jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can change payment instructions.' using errcode = '42501';
  end if;
  if char_length(why) < 3 or char_length(why) > 500 then
    raise exception 'Give a reason of 3 to 500 characters.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_fr, '')) > 2000 or char_length(coalesce(p_en, '')) > 2000 or char_length(coalesce(p_ar, '')) > 2000 then
    raise exception 'Instructions are limited to 2000 characters.' using errcode = 'check_violation';
  end if;
  if p_enabled and (char_length(trim(coalesce(p_fr, ''))) = 0 or char_length(trim(coalesce(p_en, ''))) = 0 or char_length(trim(coalesce(p_ar, ''))) = 0) then
    raise exception 'A method can be offered only with instructions in French, English and Arabic.' using errcode = 'check_violation';
  end if;
  select * into cur from public.payment_method_settings where method = p_method for update;
  if not found then
    raise exception 'Unknown payment method.' using errcode = 'P0002';
  end if;

  before_state := jsonb_build_object('enabled', cur.enabled, 'instructions_fr', cur.instructions_fr,
                                     'instructions_en', cur.instructions_en, 'instructions_ar', cur.instructions_ar);
  after_state := jsonb_build_object('enabled', p_enabled, 'instructions_fr', coalesce(p_fr, ''),
                                    'instructions_en', coalesce(p_en, ''), 'instructions_ar', coalesce(p_ar, ''));
  insert into public.payment_method_history (method, actor_id, reason, previous, next)
  values (p_method, auth.uid(), why, before_state, after_state);
  update public.payment_method_settings
     set enabled = p_enabled, instructions_fr = coalesce(p_fr, ''), instructions_en = coalesce(p_en, ''), instructions_ar = coalesce(p_ar, ''),
         updated_by = auth.uid(), updated_at = now()
   where method = p_method;
  insert into public.payment_audit (method, action, from_status, to_status, actor_id, reason)
  values (p_method, 'method_changed', case when cur.enabled then 'enabled' else 'disabled' end,
          case when p_enabled then 'enabled' else 'disabled' end, auth.uid(), why);
end $$;

-- Owner: record a payment received outside the platform (cash, bank, CCP). Never a proof, never already decided.
create or replace function public.record_manual_payment(
  p_application uuid, p_amount numeric, p_currency text, p_method text, p_status text,
  p_reference text, p_note text, p_received_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can record a payment.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'received', 'cancelled') then
    raise exception 'Unknown payment status.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.applications a where a.id = p_application) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  insert into public.payments (application_id, amount, currency, method, status, reference, note, created_by, received_at)
  values (p_application, p_amount, p_currency, p_method, p_status, coalesce(p_reference, ''), coalesce(p_note, ''), auth.uid(),
          case when p_status = 'received' then coalesce(p_received_on::timestamptz + interval '12 hours', now()) else null end)
  returning id into new_id;
  return new_id;
end $$;

-- Owner: change the status of a payment recorded without a proof. A proof-bearing payment changes only by its decision.
create or replace function public.set_manual_payment_status(p_payment uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.payments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can change a payment.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'received', 'cancelled') then
    raise exception 'Unknown payment status.' using errcode = 'check_violation';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if p.evidence_path is not null then
    raise exception 'A payment with a proof changes only through the owner''s decision.' using errcode = 'check_violation';
  end if;
  update public.payments
     set status = p_status,
         received_at = case when p_status = 'received' then coalesce(p.received_at, now()) else null end
   where id = p_payment;
end $$;

-- Owner: delete a request. Refused, with nothing changed, while any protected record exists: a proof, a decided or audited
-- payment, or a proof removal. Returns the document files that must now be removed from storage.
create or replace function public.delete_application_request(p_application uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  paths text[];
begin
  if not public.is_admin() then
    raise exception 'Only the owner can delete a request.' using errcode = '42501';
  end if;
  perform 1 from public.applications where id = p_application for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payments p where p.application_id = p_application and p.evidence_path is not null)
     or exists (select 1 from public.payments p where p.application_id = p_application and p.status in ('received', 'rejected', 'pending_review'))
     or exists (select 1 from public.payment_audit a where a.application_id = p_application or a.payment_id in (select id from public.payments where application_id = p_application))
     or exists (select 1 from public.proof_removals r where r.application_id = p_application) then
    raise exception 'This request has protected payments or records, which are kept. Nothing was deleted.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(d.storage_path), '{}') into paths from public.documents d where d.application_id = p_application;
  delete from public.payments where application_id = p_application;
  delete from public.applications where id = p_application;
  return paths;
end $$;

-- Owner: unsubmitted proofs that are old enough to remove (at least seven days). Read only.
create or replace function public.orphan_payment_proofs(p_retention interval default interval '7 days')
returns table (object_name text, application_id uuid, uploaded_at timestamptz)
language plpgsql security definer set search_path = public, storage as $$
declare
  keep_for interval := greatest(coalesce(p_retention, interval '7 days'), interval '7 days');
begin
  if not public.is_admin() then
    raise exception 'Only the owner can review unsubmitted proofs.' using errcode = '42501';
  end if;
  return query
    select o.name, (split_part(o.name, '/', 2))::uuid, o.created_at
      from storage.objects o
     where o.bucket_id = 'customer-documents'
       and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/payment-'
       and o.created_at < now() - keep_for
       and not exists (select 1 from public.payments p where p.evidence_path = o.name)
       and not exists (select 1 from public.proof_removals r where r.object_name = o.name and r.status = 'intent')
     order by o.created_at;
end $$;

-- Owner: is this proof still eligible for removal, now?
create or replace function public.orphan_proof_still_eligible(p_name text, p_retention interval default interval '7 days')
returns boolean language plpgsql security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then
    raise exception 'Only the owner can review unsubmitted proofs.' using errcode = '42501';
  end if;
  return exists (select 1 from public.orphan_payment_proofs(p_retention) e where e.object_name = p_name);
end $$;

-- Owner, step 1 of a removal: records the intent. Under the same lock as a submission, so a proof cannot be submitted
-- after this check and removed before its reference is seen. The file is removed afterwards, by the application.
create or replace function public.begin_orphan_removal(p_name text, p_reason text, p_retention interval default interval '7 days')
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare
  why text := trim(coalesce(p_reason, ''));
  new_id uuid;
  app_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can remove unsubmitted proofs.' using errcode = '42501';
  end if;
  if char_length(why) < 3 or char_length(why) > 500 then
    raise exception 'Give a reason of 3 to 500 characters.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_name));
  if not public.orphan_proof_still_eligible(p_name, p_retention) then
    raise exception 'This proof is not eligible for removal.' using errcode = 'check_violation';
  end if;
  app_id := (split_part(p_name, '/', 2))::uuid;
  insert into public.proof_removals (object_name, application_id, actor_id, reason, status)
  values (p_name, app_id, auth.uid(), why, 'intent')
  returning id into new_id;
  return new_id;
end $$;

-- Owner, step 2 of a removal: records the result. "Removed" is written only when the file is confirmed gone.
create or replace function public.finish_orphan_removal(p_removal uuid, p_removed boolean, p_detail text default null)
returns text language plpgsql security definer set search_path = public, storage as $$
declare
  r public.proof_removals%rowtype;
  outcome text;
  note text := left(coalesce(p_detail, ''), 300);
begin
  if not public.is_admin() then
    raise exception 'Only the owner can record a removal.' using errcode = '42501';
  end if;
  select * into r from public.proof_removals where id = p_removal for update;
  if not found then
    raise exception 'Removal not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'intent' then
    raise exception 'This removal already has its result.' using errcode = 'check_violation';
  end if;
  if p_removed and exists (select 1 from storage.objects o where o.bucket_id = 'customer-documents' and o.name = r.object_name) then
    outcome := 'failed';
    note := 'The file is still present after the removal.';
  elsif p_removed then
    outcome := 'removed';
  else
    outcome := 'failed';
    note := coalesce(nullif(note, ''), 'The storage removal did not succeed.');
  end if;

  update public.proof_removals set status = outcome, detail = nullif(note, ''), finished_at = now() where id = p_removal;
  if outcome = 'removed' then
    insert into public.payment_audit (application_id, action, actor_id, reason)
    values (r.application_id, 'orphan_purged', auth.uid(), r.reason);
  end if;
  return outcome;
end $$;

-- Owner: resolves removals left open (the process stopped between the two steps). If the file is gone, the removal is
-- recorded as done; if it is still there, it is recorded as failed. Nothing is assumed.
create or replace function public.reconcile_orphan_removals(p_older_than interval default interval '1 hour')
returns table (removal_id uuid, outcome text)
language plpgsql security definer set search_path = public, storage as $$
declare
  r record;
  present boolean;
begin
  if not public.is_admin() then
    raise exception 'Only the owner can reconcile removals.' using errcode = '42501';
  end if;
  for r in select * from public.proof_removals x where x.status = 'intent' and x.requested_at < now() - greatest(p_older_than, interval '5 minutes') for update loop
    present := exists (select 1 from storage.objects o where o.bucket_id = 'customer-documents' and o.name = r.object_name);
    if present then
      update public.proof_removals set status = 'failed', detail = 'Not confirmed on reconciliation: the file is still present.', finished_at = now() where id = r.id;
      removal_id := r.id; outcome := 'failed';
    else
      update public.proof_removals set status = 'removed', detail = 'Confirmed gone on reconciliation.', finished_at = now() where id = r.id;
      insert into public.payment_audit (application_id, action, actor_id, reason)
      values (r.application_id, 'orphan_purged', auth.uid(), 'Removal confirmed on reconciliation');
      removal_id := r.id; outcome := 'removed';
    end if;
    return next;
  end loop;
end $$;

-- Only signed-in users may call these; each one checks who the caller is.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'proof_is_referenced(text)',
    'submit_payment_evidence(uuid, text, text, text, integer, text)',
    'decide_payment(uuid, text, text, text)',
    'save_payment_method(text, boolean, text, text, text, text)',
    'record_manual_payment(uuid, numeric, text, text, text, text, text, date)',
    'set_manual_payment_status(uuid, text)',
    'delete_application_request(uuid)',
    'orphan_payment_proofs(interval)',
    'orphan_proof_still_eligible(text, interval)',
    'begin_orphan_removal(text, text, interval)',
    'finish_orphan_removal(uuid, boolean, text)',
    'reconcile_orphan_removals(interval)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Trigger functions run with the caller's rights and only read the row they guard.
revoke all on function public.payment_guard() from public, anon, authenticated;
revoke all on function public.payment_no_delete_with_proof() from public, anon, authenticated;
revoke all on function public.payment_insert_guard() from public, anon, authenticated;
revoke all on function public.append_only_guard() from public, anon, authenticated;
