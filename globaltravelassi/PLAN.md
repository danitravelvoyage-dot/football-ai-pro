# GLOBALTRAVELASSI — Development Plan

> **Historical, 18–19 November 2026.** The original plan. Payments, organised European trips and the five-service list were later changed; see `docs/FINAL_TECHNICAL_REPORT.md` and `docs/final/GLOBALTRAVELASSI_FINAL_COMPLETION_REPORT.md`.

## 1. Requirements analysis
- Brand: GLOBALTRAVELASSI travel & visa consulting (Algeria / North Africa). Platform name: GLOBALTRAVELASSI.
- Languages: Arabic (RTL, default), French, English. Every public and admin label is translated.
- Customers: landing pages, 5 service pages, application form (with documents), account, dashboard to track requests, WhatsApp contact.
- Admin: secure login, customers list, applications (status, internal notes, documents, payments), services & prices, statistics and reports.
- Payments: tracked manually by the admin (amount, method, reference, status). The app never claims a payment was confirmed unless the admin records it.

## 2. Architecture
- Next.js 15 (App Router, TypeScript, server actions) + Tailwind CSS 3.
- Supabase for: Postgres database, Auth (email + password), private Storage bucket for documents.
- Security model:
  - Row Level Security on every table; `is_admin()` security-definer helper.
  - Customers cannot change their own `role` or `is_active` (trigger-enforced).
  - Admin routes protected in middleware AND re-checked in the admin layout and every server action.
  - Documents in a PRIVATE bucket; access only via short-lived signed URLs created server-side under RLS.
  - Only the public anon key reaches the browser. No service-role key is used anywhere in the app.
- i18n: locale path prefix (`/ar`, `/fr`, `/en`), typed dictionaries, `dir="rtl"` for Arabic, logical CSS properties so layouts mirror correctly.

## 3. Data model
profiles · services · applications · documents · payments · application_notes · application_events

## 4. Build steps
1. Scaffold project, tooling (lint, typecheck, tests, build).
2. Database schema, RLS, storage policies, seed data (SQL migration).
3. i18n dictionaries and locale routing.
4. Auth: register, login, forgot/reset password, session refresh middleware.
5. Public site: home, services, service prices, WhatsApp integration.
6. Application form with validation and document upload.
7. Customer dashboard: requests, status timeline, documents, payments.
8. Admin: stats, customers, applications (status / notes / documents / payments), services & prices, reports.
9. Tests: validation, status rules, i18n parity, SQL/RLS behaviour (PGlite).
10. Deployment guide (non-technical) and owner guide.

## 5. Out of scope in this build (stated plainly)
- Automatic online payment gateways (no fake confirmations; payments are recorded by admin).
- Automated emails beyond Supabase's built-in auth emails.
