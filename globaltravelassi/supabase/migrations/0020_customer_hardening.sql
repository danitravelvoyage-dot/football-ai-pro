-- 0020: customer write hardening, service categories and the request language. Additive. NOT applied: applying it
-- needs the owner's approval.
--
-- Depends only on the base schema (0001). It does not depend on the AI migrations (0002-0018) or on 0019.
-- Rollback: docs/migrations/0020_rollback.sql.
--
-- Fixes found in the launch audit (the server actions already check the same things; these close the direct-API path,
-- where a signed-in customer calls the database with the public key and their own token):
--   1. A customer could insert a document row already marked verified.
--   2. A customer could register a document row pointing at a file outside their own request folder, so the owner
--      would open another customer's file under this customer's request.
--   3. A customer could choose the reference, id or timestamps of a new request.
--   4. A disabled account could still create requests, register documents and upload files.

-- ---------- 1. Active account -------------------------------------------------------------------------------------

-- True for a signed-in user whose profile is active. SECURITY DEFINER avoids recursion through the profiles policy.
create or replace function public.is_active_account()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;
revoke all on function public.is_active_account() from public, anon;
grant execute on function public.is_active_account() to authenticated;

-- ---------- 2. Request language (used for customer emails sent after an owner's action) ---------------------------

alter table public.applications add column if not exists locale text not null default 'ar'
  check (locale in ('ar', 'fr', 'en'));

-- ---------- 3. Requests: only the customer's own fields, only by an active account --------------------------------

revoke insert on public.applications from authenticated;
grant insert (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country,
              travel_date, employment_status, previous_travel_history, additional_info, source, locale)
  on public.applications to authenticated;

drop policy if exists applications_owner_insert on public.applications;
create policy applications_owner_insert on public.applications for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_account()
    and status = 'new'
    and exists (select 1 from public.services s where s.id = service_id and s.is_active)
  );

-- ---------- 4. Documents: never pre-verified, always inside the request's own folder -------------------------------

revoke insert on public.documents from authenticated;
grant insert (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
  on public.documents to authenticated;

drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert on public.documents for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_account()
    and verified = false
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and split_part(storage_path, '/', 2) = application_id::text
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid() and a.status in ('new', 'documents_required')
    )
  );

-- ---------- 5. Storage: a disabled account cannot upload --------------------------------------------------------------

drop policy if exists "docs_owner_upload" on storage.objects;
create policy "docs_owner_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'customer-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_account()
  );

-- ---------- 6. Service categories: bookings and itineraries ------------------------------------------------------------

alter table public.services drop constraint if exists services_category_check;
alter table public.services add constraint services_category_check check (
  category in ('visa', 'appointment', 'e_visa', 'transit', 'european_trip', 'consultation', 'booking', 'itinerary')
);
