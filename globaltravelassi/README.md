# GLOBALTRAVELASSI

Website, customer area and admin dashboard for GLOBALTRAVELASSI, a visa and travel assistance business. Arabic (right to left), French and English. Built with Next.js 15 (App Router) and Supabase (authentication, database, private storage).

## What the site does

- Public pages in three languages: home, nine service pages, services list, privacy notice, terms of use, cookie notice.
- Sign-up, sign-in, password reset (Supabase Auth).
- Customer area: create a service request, upload documents to private storage, follow the status and timeline, contact the team on WhatsApp.
- Admin dashboard: request list with filters, request detail with status, notes, documents, CRM (lead source, customer category, contact log, internal activity), statistics, customer list, services and prices, CSV export, customer email log.
- Nine customer emails: seven sent by the app and two (sign-up confirmation, password reset) sent by Supabase Auth. See `docs/EMAIL_NOTIFICATIONS.md`.

There is **no payment workflow**. Prices are shown as "price on request" unless the owner sets one. There is no payment gateway, no payment proof upload and no automatic payment confirmation.

The AI back office under `/admin/command-center` is deferred. It is not part of the launch and needs migrations 0002 to 0018, which are not applied in this launch sequence.

## Requirements

- Node.js 22 (the project is tested on 22.x) and npm.
- A Supabase project (free tier is enough for staging). Nothing here needs a paid service.

## Install and run locally

```bash
npm ci
cp .env.example .env.local   # then fill in the values (see docs/ENVIRONMENT.md)
npm run dev                  # http://localhost:3000 (redirects to /ar)
```

Without Supabase variables the site still renders the public pages. Services fall back to the copy in `lib/services-content.ts`. Sign-in and the customer and admin areas need a configured project.

## Checks

```bash
npm run verify        # lint, typecheck, unit and database tests (PGlite), production build
npm run test:browser  # after a build: smoke test of the production server (needs Chromium)
```

`verify` does not contact any database or send any email. The database tests run on an in-memory Postgres (PGlite).

## Database

Apply the migrations to a Supabase project in the order in `docs/MIGRATIONS.md`. The customer launch uses `0001`, the base seed, `0019` to `0023`, and `seed_catalog.sql`. Migrations `0002` to `0018` belong to the deferred AI back office and are not needed for the launch.

## Documentation

| Document | Purpose |
|---|---|
| `docs/ENVIRONMENT.md` | Every environment variable, what it is for, and whether it is secret |
| `docs/MIGRATIONS.md` | Migration order, dependencies, rollbacks, what is payment-related |
| `docs/EMAIL_NOTIFICATIONS.md` | Email flows, SMTP setup, Supabase auth templates |
| `docs/PRIVACY_AND_COOKIES.md` | What personal data is held, and the cookies the site sets |
| `docs/ADMIN_GUIDE.md` | Day-to-day use of the admin dashboard |
| `docs/staging/STAGING_RUNBOOK.md` | Staging setup and validation steps |
| `docs/LAUNCH_CHECKLIST.md` | Production launch checklist |
| `docs/FINAL_TECHNICAL_REPORT.md` | Status, tests, risks and open items |
| `docs/security/` | Redirect and Content-Security-Policy design |

## Deployment

Read `DEPLOYMENT.md`. Staging comes first (`docs/staging/STAGING_RUNBOOK.md`). Production only after staging validation and the owner's approval.
