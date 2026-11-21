# Staging runbook: customer website launch

Scope: the customer website and admin dashboard, with manual payments and customer emails. The AI back office (migrations 0002–0018) is **deferred** and not part of this path. Nothing in this runbook has been run. Each step marked **Approval** needs the owner's explicit go-ahead.

## 0. Before you start

- [ ] **Approval:** create a separate, free Supabase project for staging. Never use the production project.
- [ ] Keep `EMAIL_DELIVERY_ENABLED` unset or `false` on staging until step 6.
- [ ] Have the staging project URL and anon key ready, for the hosting environment only. Never commit them.

## 1. Schema (in this order)

| Order | File | Depends on | Rollback |
|---|---|---|---|
| 1 | `supabase/migrations/0001_init.sql` | — | Not provided (base schema) |
| 2 | `supabase/seed.sql` | 0001 | Delete the seeded services by hand if needed |
| 3 | `supabase/migrations/0019_manual_payments.sql` | 0001 | `docs/migrations/0019_rollback.sql` (refuses while 0019-only rows exist) |
| 4 | `supabase/migrations/0020_customer_hardening.sql` | 0001 | `docs/migrations/0020_rollback.sql` (refuses while booking or itinerary services exist) |
| 5 | `supabase/migrations/0021_customer_email_notifications.sql` | 0001, 0019, 0020 | `docs/migrations/0021_rollback.sql` (keeps the email log) |
| 6 | `supabase/seed_catalog.sql` | 0020 | Deactivate the services in the admin dashboard |

- [ ] **Approval:** apply 1 to 6 in the SQL editor of the **staging** project, one file at a time. Stop at the first error.
- [ ] Before applying, compare each file's SHA-256 with `docs/migrations/manifest.json`. A mismatch means the file changed after review.
- [ ] The order and the independence from the AI migrations are tested on PGlite (`tests/db/customer-hardening-emails.test.ts`, `tests/db/migration-*.test.ts`). Running on Supabase is the first real run.

**The app code needs 0019, 0020 and 0021.** Without 0020, creating a request fails, because the request now records its language. Deploy the code only after the migrations.

## 2. First owner account

1. Register on the staging site with the owner's email, and confirm it.
2. In the SQL editor: `update public.profiles set role = 'admin' where email = '<owner email>';`
3. Sign out and sign in again. `/en/admin` should open.

## 3. Hosting environment (staging)

Set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`. Leave the email variables empty for now.

`NEXT_PUBLIC_SUPABASE_URL` must be set **at build time**: the content security policy uses it to allow the exact Supabase origin instead of `*.supabase.co`.

## 4. Supabase settings

- Authentication → URL Configuration: site URL and `https://<staging-domain>/*/auth/callback`.
- Authentication → Email Templates: paste `supabase/templates/confirmation.html` and `recovery.html` (see `docs/EMAIL_NOTIFICATIONS.md`).
- Storage: check that the bucket `customer-documents` exists and is **private** (created by 0001).

## 5. Logged-in checks (manual, then automate)

With a throwaway customer account and the owner account, in **ar, fr and en**, at desktop width and at 375px:

- [ ] Register, confirm the email, sign in, sign out, reset the password.
- [ ] Create a request for each service type. The dashboard lists it.
- [ ] Upload a PDF, a JPEG and a PNG. A 12 MB file and a `.docx` file are refused. (A file renamed to `.pdf` is accepted: the type is taken from the browser, not the content. That's a documented, accepted risk.)
- [ ] Remove a document while the request is "new". It cannot be removed once in review.
- [ ] Owner: set "documents required", then "approved". The timeline shows both, in the visitor's language.
- [ ] Owner: enable USDT, BaridiMob and RedotPay with **test** instructions (not real account details), in all three languages.
- [ ] Customer: the payment panel shows the amount and the instructions. Upload a proof. The panel then shows "waiting for review", not a second upload.
- [ ] Owner: reject the proof with a customer message. The customer sees it and can upload again. Then approve. The request shows "paid".
- [ ] A second customer cannot open the first customer's request or document links (try the URLs directly).
- [ ] The owner disables the customer account. The customer can no longer sign in, and direct posts are refused.
- [ ] Browser console: no CSP violation reports on any of these pages (the policy is report-only). Record any you see.

## 6. Email on staging

- [ ] Configure SMTP with a test mailbox (see `docs/EMAIL_NOTIFICATIONS.md`). Use only throwaway customer accounts whose addresses you own.
- [ ] Set `EMAIL_DELIVERY_ENABLED=true` on staging only, and repeat the flows in step 5.
- [ ] Check **Admin → Customer emails**: each flow shows one row with status "Sent". No duplicates after a page refresh or a double click.
- [ ] Check the received emails in Gmail and Outlook, on a phone, in ar (right to left), fr and en.
- [ ] Put a wrong SMTP password. The row shows "Failed / auth_failed" and the customer's action still succeeds. Fix it, then retry from the admin page.

## 7. Exit criteria for staging

All boxes above are ticked. There are zero unexplained CSP reports, zero duplicate emails, and no customer can see another customer's data. Then decide on CSP enforcement (`docs/security/CONTENT_SECURITY_POLICY.md`) and production (`docs/LAUNCH_CHECKLIST.md`).

## Rollback order

0021, then 0020, then 0019, each with its rollback script and the owner's approval. Rollbacks keep audit and email records. Deleting them is a separate decision.
