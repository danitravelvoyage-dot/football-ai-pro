-- 0021: customer email notifications (outbox and delivery log). Additive. NOT applied: applying it needs the owner's
-- approval. Rollback: docs/migrations/0021_rollback.sql.
--
-- Depends on 0001 (requests, documents, events, profiles), 0019 (payment statuses and the customer-visible rejection
-- message) and 0020 (applications.locale, is_active_account()). It does not depend on the AI migrations.
--
-- Rules:
--  * One row per email. The dedupe key is computed here from the kind and the record the email is about, so the same
--    email is never queued twice, whatever the caller sends.
--  * The recipient is the account email of the request's owner (profiles.email, copied from the sign-in account).
--    The caller never chooses it.
--  * The template data is built here from customer-visible fields only: the reference, the service title, the
--    status, the message the owner wrote for the customer, the amount, the document type. Internal notes, the owner's
--    internal reason, file paths and the owner's identity are never copied.
--  * No client role writes the table. Every write goes through the functions below.

create table if not exists public.customer_email_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  kind text not null check (kind in (
    'application_received', 'application_status_updated', 'additional_documents_requested', 'application_approved',
    'application_rejected', 'payment_proof_received', 'payment_approved', 'payment_rejected',
    'document_upload_confirmed', 'document_review_result')),
  application_id uuid references public.applications (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  recipient text not null default '' check (char_length(recipient) <= 254),
  locale text not null check (locale in ('ar', 'fr', 'en')),
  template_data jsonb not null default '{}'::jsonb check (jsonb_typeof(template_data) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text check (last_error is null or last_error ~ '^[a-z_]{1,60}$'),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  constraint customer_email_sent_has_date check (status <> 'sent' or sent_at is not null)
);

create index if not exists customer_email_status_idx on public.customer_email_notifications (status, created_at desc);
create index if not exists customer_email_application_idx on public.customer_email_notifications (application_id, created_at);

alter table public.customer_email_notifications enable row level security;
drop policy if exists customer_email_owner_read on public.customer_email_notifications;
create policy customer_email_owner_read on public.customer_email_notifications for select to authenticated
  using (public.is_admin());
revoke all on public.customer_email_notifications from anon;
revoke insert, update, delete, truncate on public.customer_email_notifications from authenticated;

-- A sent email stays sent; nothing is deleted from the log.
create or replace function public.customer_email_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'The email log is kept.' using errcode = '42501';
  end if;
  -- A deleted request or account only clears its link (on delete set null); the delivery record itself never changes.
  if old.status = 'sent' and (new.status is distinct from old.status or new.attempts is distinct from old.attempts
       or new.sent_at is distinct from old.sent_at or new.last_error is distinct from old.last_error
       or new.provider_message_id is distinct from old.provider_message_id) then
    raise exception 'A sent email cannot change.' using errcode = 'check_violation';
  end if;
  if new.dedupe_key is distinct from old.dedupe_key or new.kind is distinct from old.kind
     or new.recipient is distinct from old.recipient or new.template_data is distinct from old.template_data
     or new.locale is distinct from old.locale or new.created_at is distinct from old.created_at then
    raise exception 'The content of a queued email cannot change.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists customer_email_guard on public.customer_email_notifications;
create trigger customer_email_guard before update or delete on public.customer_email_notifications
  for each row execute function public.customer_email_guard();
revoke all on function public.customer_email_guard() from public, anon, authenticated;

-- Queue an email about one record. Returns the queued row, or no row when this email was already queued.
-- Customer kinds may be queued by the request's owner (active account) or the owner of the business; the other kinds
-- only by the owner of the business.
create or replace function public.enqueue_customer_email(p_kind text, p_subject uuid)
returns table (email_id uuid, email_recipient text, email_locale text, email_data jsonb, email_status text)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  owner_side boolean := public.is_admin();
  app public.applications%rowtype;
  ev record;
  pay record;
  doc record;
  prof record;
  svc record;
  data jsonb := '{}'::jsonb;
  key text;
  to_whom text;
  initial_status text := 'pending';
  initial_error text := null;
  new_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_kind in ('application_received', 'payment_proof_received', 'document_upload_confirmed') then
    if not owner_side and not public.is_active_account() then
      raise exception 'This account is disabled.' using errcode = '42501';
    end if;
  elsif p_kind in ('application_status_updated', 'additional_documents_requested', 'application_approved',
                   'application_rejected', 'payment_approved', 'payment_rejected', 'document_review_result') then
    if not owner_side then
      raise exception 'Only the owner can send this email.' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown email kind.' using errcode = 'check_violation';
  end if;

  if p_kind = 'application_received' then
    select * into app from public.applications a where a.id = p_subject;
    if not found then raise exception 'Record not found.' using errcode = 'P0002'; end if;
    key := p_kind || ':' || p_subject::text;

  elsif p_kind in ('application_status_updated', 'additional_documents_requested', 'application_approved', 'application_rejected') then
    select e.application_id, e.kind, e.to_status, e.message into ev from public.application_events e where e.id = p_subject;
    if not found or ev.kind <> 'status' or ev.to_status is null then
      raise exception 'Record not found.' using errcode = 'P0002';
    end if;
    if (p_kind = 'additional_documents_requested') <> (ev.to_status = 'documents_required')
       or (p_kind = 'application_approved') <> (ev.to_status = 'approved')
       or (p_kind = 'application_rejected') <> (ev.to_status = 'rejected') then
      raise exception 'The email does not match the status.' using errcode = 'check_violation';
    end if;
    select * into app from public.applications a where a.id = ev.application_id;
    data := jsonb_build_object('status', ev.to_status, 'message', coalesce(ev.message, ''));
    key := p_kind || ':' || p_subject::text;

  elsif p_kind in ('payment_proof_received', 'payment_approved', 'payment_rejected') then
    select p.application_id, p.amount, p.currency, p.method, p.status, p.customer_visible_rejection_message as customer_message
      into pay from public.payments p where p.id = p_subject;
    if not found then raise exception 'Record not found.' using errcode = 'P0002'; end if;
    if (p_kind = 'payment_proof_received' and pay.status <> 'pending_review')
       or (p_kind = 'payment_approved' and pay.status <> 'received')
       or (p_kind = 'payment_rejected' and pay.status <> 'rejected') then
      raise exception 'The email does not match the payment.' using errcode = 'check_violation';
    end if;
    select * into app from public.applications a where a.id = pay.application_id;
    data := jsonb_build_object('amount', pay.amount::text, 'currency', pay.currency, 'method', pay.method);
    if p_kind = 'payment_rejected' then
      data := data || jsonb_build_object('message', coalesce(pay.customer_message, ''));
    end if;
    key := p_kind || ':' || p_subject::text;

  else -- document_upload_confirmed, document_review_result
    select d.application_id, d.doc_type, d.verified into doc from public.documents d where d.id = p_subject;
    if not found then raise exception 'Record not found.' using errcode = 'P0002'; end if;
    select * into app from public.applications a where a.id = doc.application_id;
    data := jsonb_build_object('doc_type', doc.doc_type);
    key := p_kind || ':' || p_subject::text;
    if p_kind = 'document_review_result' then
      data := data || jsonb_build_object('verified', doc.verified);
      key := key || ':' || case when doc.verified then 'verified' else 'not_verified' end;
    end if;
  end if;

  if app.id is null then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
  -- A customer may queue an email only about their own request; they learn nothing about anyone else's.
  if not owner_side and app.user_id <> uid then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;

  select p.email, p.full_name into prof from public.profiles p where p.id = app.user_id;
  select s.title_ar, s.title_fr, s.title_en into svc from public.services s where s.id = app.service_id;
  to_whom := lower(trim(coalesce(prof.email, '')));
  if to_whom !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(to_whom) > 254 then
    to_whom := '';
    initial_status := 'skipped';
    initial_error := 'invalid_recipient';
  end if;

  data := data || jsonb_build_object(
    'reference', app.reference,
    'application_id', app.id,
    'customer_name', coalesce(nullif(trim(prof.full_name), ''), app.full_name),
    'service_title_ar', coalesce(svc.title_ar, ''),
    'service_title_fr', coalesce(svc.title_fr, ''),
    'service_title_en', coalesce(svc.title_en, ''));

  insert into public.customer_email_notifications as n
    (dedupe_key, kind, application_id, user_id, recipient, locale, template_data, status, last_error, created_by)
  values (key, p_kind, app.id, app.user_id, to_whom, app.locale, data, initial_status, initial_error, uid)
  on conflict (dedupe_key) do nothing
  returning n.id into new_id;

  if new_id is null then
    return; -- already queued: nothing to send
  end if;
  return query select new_id, to_whom, app.locale, data, initial_status;
end $$;

-- Record the result of one delivery attempt. Only the session that queued the email, or the owner, may record it.
-- An email already sent is final.
create or replace function public.record_customer_email_delivery(p_id uuid, p_status text, p_error text default null, p_message_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.customer_email_notifications%rowtype;
  code text := nullif(p_error, '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Unknown delivery status.' using errcode = 'check_violation';
  end if;
  select * into n from public.customer_email_notifications where id = p_id for update;
  if not found or not (public.is_admin() or n.created_by = auth.uid()) then
    raise exception 'Email not found.' using errcode = 'P0002';
  end if;
  if n.status <> 'pending' then
    raise exception 'This email is not waiting for a result.' using errcode = 'check_violation';
  end if;
  if code is not null and code !~ '^[a-z_]{1,60}$' then
    code := 'send_failed';
  end if;
  update public.customer_email_notifications
     set status = p_status,
         attempts = least(attempts + 1, 20),
         last_attempt_at = now(),
         sent_at = case when p_status = 'sent' then now() else null end,
         last_error = case when p_status = 'sent' then null else code end,
         provider_message_id = case when p_status = 'sent' then left(p_message_id, 200) else provider_message_id end
   where id = p_id;
end $$;

-- Owner: take one failed email for another attempt. Only one caller can take it, so a retry never sends the same email
-- twice at the same time. At most five attempts. An email left "pending" (the process stopped between sending and
-- recording) is NOT retried automatically: it may already have been delivered, and a duplicate is worse than a gap.
-- The owner sees it in the log and can contact the customer.
create or replace function public.claim_customer_email_retry(p_id uuid)
returns table (email_id uuid, email_kind text, email_recipient text, email_locale text, email_data jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the owner can retry emails.' using errcode = '42501';
  end if;
  return query
    update public.customer_email_notifications n
       set status = 'pending', claimed_at = now()
     where n.id = p_id
       and n.attempts < 5
       and n.recipient <> ''
       and n.status = 'failed'
    returning n.id, n.kind, n.recipient, n.locale, n.template_data;
end $$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'enqueue_customer_email(text, uuid)',
    'record_customer_email_delivery(uuid, text, text, text)',
    'claim_customer_email_retry(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
