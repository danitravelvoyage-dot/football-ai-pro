# Staging runbook

Status: **not started**. The free-plan project limit on the organisation was reached, so no staging project could be created (see `docs/FINAL_TECHNICAL_REPORT.md`). The steps below are what the owner or the team runs once a free staging project exists.

## 0. Prerequisites

- [ ] A **new**, free Supabase project for staging. Never the project named `globaltravelassi` if it is production. Confirm the project ref before every step.
- [ ] The owner has decided the free-plan limit: pause or delete an unrelated project, or accept another route. No upgrade and no paid plan without approval.
- [ ] `EMAIL_DELIVERY_ENABLED` unset or `false`. No real customer address is used on staging.

## 1. Migrations, in this order, one at a time (`docs/MIGRATIONS.md`)

1. `supabase/migrations/0001_init.sql`
2. `supabase/seed.sql`
3. `supabase/migrations/0019_manual_payments.sql`
4. `supabase/migrations/0020_customer_hardening.sql`
5. `supabase/migrations/0021_customer_email_notifications.sql`
6. `supabase/migrations/0022_remove_payment_workflow.sql`
7. `supabase/migrations/0023_crm_attribution_requests.sql`
8. `supabase/seed_catalog.sql`

Before each file: compare its SHA-256 with `docs/migrations/manifest.json`. Stop at the first error. Record the result of each step.

Do **not** apply `0002` to `0018`. They belong to the deferred AI back office.

## 2. First owner account

1. Register on staging with a throwaway owner address you control.
2. In the SQL editor: `update public.profiles set role = 'admin' where email = '<staging owner email>';`
3. Sign in again. `/en/admin` opens.

## 3. Hosting environment (staging)

Set the public variables and the site address. Leave the email variables unset. See `docs/ENVIRONMENT.md`.

## 4. Supabase settings

- Authentication → URL configuration: site URL and `https://<staging-domain>/*/auth/callback`.
- Authentication → email templates: `supabase/templates/confirmation.html` and `recovery.html`.
- Storage: `customer-documents` exists and is private.

## 5. Logged-in checks (manual; throwaway accounts only)

In ar, fr and en, at desktop and at 375px:

- [ ] Register, confirm, sign in, sign out, reset the password.
- [ ] Submit a request for one service. The confirmation page shows the reference; the request appears in the dashboard.
- [ ] Submit the same form twice quickly (double click). Exactly one request is created.
- [ ] Fill the hidden "website" field with a test value (browser dev tools). No request is created; the page redirects to the dashboard.
- [ ] Upload a PDF, a JPEG and a PNG. Rename a text file to `.pdf`: it is refused.
- [ ] Remove a document while the request is "new". After "in review", the upload and removal controls are gone.
- [ ] Owner: set "documents required", then "approved". The timeline shows both in the customer's language.
- [ ] Owner: correct a lead source with a reason. The activity log shows the change.
- [ ] Owner: record a WhatsApp contact. The request shows the last contact.
- [ ] A second customer cannot open the first customer's request or document links (try the URLs directly).
- [ ] The owner disables a customer account. That customer can no longer sign in or submit.
- [ ] No payment screen or payment text is reachable.
- [ ] Browser console: no content security policy violation on these pages (the policy is report-only). Record any.

## 6. Email on staging (only with a test mailbox you own)

- [ ] Configure SMTP with a test account (`docs/EMAIL_NOTIFICATIONS.md`).
- [ ] Set `EMAIL_DELIVERY_ENABLED=true` on staging only. Repeat the flows in section 5.
- [ ] **Admin → Customer emails**: one row per flow, status "Sent", no duplicates after a refresh or a double click.
- [ ] Check the emails in Gmail and Outlook, on a phone, in ar, fr and en.
- [ ] Use a wrong SMTP password once: the row shows "Failed / auth_failed"; the customer's action still succeeds. Fix it and retry from the admin page.

## 7. Exit criteria

All boxes ticked, no unexplained CSP reports, no duplicate emails, and no customer sees another customer's data. Then the team decides on CSP enforcement (`docs/security/CONTENT_SECURITY_POLICY.md`) and production (`docs/LAUNCH_CHECKLIST.md`).

## Rollback

0023, 0022 and 0021 have rollback scripts (`docs/MIGRATIONS.md`). Rollbacks keep the audit and email records. Dropping them is a separate decision, made by the owner.
