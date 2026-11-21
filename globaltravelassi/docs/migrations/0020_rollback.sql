-- Rollback of 0020_customer_hardening.sql. Run only with the owner's approval, and only if 0020 must be withdrawn.
-- Restores the 0001 policies and grants. Refuses to run while a service uses a category that 0020 added, because the
-- 0001 category rule would reject it. The applications.locale column is kept: dropping it would delete data, and
-- 0001 code ignores it. If 0021 is applied, roll back 0021 first.

do $$
begin
  if exists (select 1 from public.services where category in ('booking', 'itinerary')) then
    raise exception 'Services use the booking or itinerary category. Change or deactivate them first. Nothing was changed.';
  end if;
end $$;

alter table public.services drop constraint if exists services_category_check;
alter table public.services add constraint services_category_check check (
  category in ('visa', 'appointment', 'e_visa', 'transit', 'european_trip', 'consultation')
);

drop policy if exists "docs_owner_upload" on storage.objects;
create policy "docs_owner_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists documents_owner_insert on public.documents;
create policy documents_owner_insert on public.documents for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid() and a.status in ('new', 'documents_required')
    )
  );
grant insert on public.documents to authenticated;

drop policy if exists applications_owner_insert on public.applications;
create policy applications_owner_insert on public.applications for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'new'
    and exists (select 1 from public.services s where s.id = service_id and s.is_active)
  );
grant insert on public.applications to authenticated;

drop function if exists public.is_active_account();
