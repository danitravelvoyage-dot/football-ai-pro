# GLOBALTRAVELASSI

Commercial platform for **GLOBALTRAVELASSI** — visa consulting, appointment assistance, e-visa, transit and airport consulting, and organised European trips for Algeria and North Africa.

- **Languages:** Arabic (default, right-to-left), French, English. Every label, email and error message is translated.
- **Customers:** landing pages built for TikTok traffic, a service catalogue with prices, a request form with document upload, an account and a dashboard to track each request, payments and timeline. WhatsApp is one tap away on every page.
- **Owner / administrators:** secure login, customer accounts, applications (status, internal notes, documents, payments), services and prices, statistics and reports, Excel-compatible export.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS, Supabase (Postgres, Auth, private Storage).

> Visa and entry decisions are made only by the competent authorities. The platform never promises an outcome and never records a payment unless an administrator enters it.

## Documents

| File | For whom |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Step-by-step set-up and going live (no programming needed) |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | Day-to-day management: requests, documents, payments, prices, reports |
| [PLAN.md](PLAN.md) | Requirements analysis and development plan |

## Project layout

```
app/[locale]/            pages: home, services, apply, auth, dashboard, admin, privacy
app/[locale]/documents   secure document download (signed link, owner or admin only)
app/[locale]/admin/reports/export   Excel-compatible CSV
components/              reusable UI, forms (ActionForm keeps input on errors), admin widgets
lib/actions/             server actions (validated, role-checked, RLS-enforced)
lib/validation/          zod schemas and translated error messages
lib/i18n/                ar / fr / en dictionaries (same keys enforced by tests)
supabase/migrations/     database, row-level security and storage policies
supabase/seed.sql        starter services (prices intentionally empty)
tests/                   validation, translation parity, and database security tests
middleware.ts            locale routing, session refresh, protected areas
```

## Development

```bash
npm install
cp .env.example .env.local      # then fill in the public Supabase values
npm run dev                     # http://localhost:3000 (redirects to /ar)
npm run verify                  # lint + typecheck + tests + production build
```

`npm test` runs:
- **Database security tests** on an embedded Postgres with the real migration: customers cannot read each other's requests, documents or internal notes; cannot promote themselves to admin; cannot approve their own request; cannot upload outside their folder; cannot upload once a request is under review; anonymous visitors see only active services.
- **Validation tests** for phone numbers, requests, passwords, payments, uploads and services.
- **Translation tests** that fail if Arabic or French is missing a key.

## Security notes

- Only the public anon key is used in the browser. The service-role key is never needed and must never be added.
- Row-level security is enabled on every table; the admin check (`is_admin()`) runs in the database, not only in the interface.
- Customer documents live in a **private** bucket: 10 MB limit, PDF/JPEG/PNG only, served through short-lived signed links.
- Redirects after sign-in are restricted to same-site paths.
- Security headers: frame denial, `nosniff`, referrer policy, restricted permissions.
- Supabase's built-in auth rate limiting protects sign-in and sign-up. Add a Vercel/Cloudflare firewall rule for extra protection if traffic grows.

## Known limits (deliberate)

- No online card or mobile-payment gateway: payments are recorded by an administrator after money is received (cash, bank transfer, CCP, BaridiMob).
- Email notifications are limited to Supabase's account emails (confirmation, password reset). Status updates reach customers through the dashboard and WhatsApp.

## Deployment

Vercel builds this project from branch `claude/affectionate-rubin-la5937`, Root Directory `globaltravelassi`. See DEPLOYMENT.md.
