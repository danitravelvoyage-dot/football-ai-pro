# Production launch checklist

Production comes after staging has passed (`docs/staging/STAGING_RUNBOOK.md`, section 7). Items marked **Owner** are decisions or actions only the owner can take. Nothing here has been done yet.

## Decisions (Owner)

- [ ] Launch scope: customer website, customer area and admin dashboard. The AI back office stays off (migrations 0002–0018 are not applied).
- [ ] Approve applying 0019–0023 and `seed_catalog.sql` to production, after a backup, and after the live project's current state has been checked read-only.
- [ ] Set the real price, or leave "price on request", for each service.
- [ ] Confirm the WhatsApp number and its country code (`8485462510`; the `+84` code is Vietnam's).
- [ ] Choose the SMTP provider and the sending address. Configure SPF, DKIM and DMARC for the domain.
- [ ] Review the legal texts (`lib/legal/content.ts`) and, if needed, get legal advice. Decide the retention periods (`docs/PRIVACY_AND_COOKIES.md`).
- [ ] Decide on Content Security Policy enforcement after staging shows no violations.

## Configuration (hosting environment, never in git)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://globaltravelassi.online`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`.
- [ ] SMTP variables. `EMAIL_DELIVERY_ENABLED=true` last, after the staging check.
- [ ] No `service_role` key anywhere in the project.
- [ ] Supabase Auth: email confirmation on; custom SMTP; templates pasted; redirect URLs limited to the production domain.

## Before switching traffic

- [ ] `npm run verify` exits 0 on the release commit. `npm run test:browser` passes against the production build.
- [ ] A database backup is taken, and a restore has been tested.
- [ ] The first owner account is created and promoted (runbook, section 2).
- [ ] One end-to-end run by the owner with their own customer account: request, document, status change, email, WhatsApp contact.
- [ ] The domain DNS is pointed at the hosting provider by the owner. This repository does not change DNS.

## First week after launch

- [ ] Check **Admin → Customer emails** daily for failed or long-pending rows.
- [ ] Check the hosting logs for errors and for `customer email` lines.
- [ ] Check new requests and their lead sources in the overview.

## Known accepted risks

- `style-src 'unsafe-inline'` in the content security policy (documented).
- Dependency advisories that need major upgrades: `next` 15 (bundled postcss, moderate and high) and `zod` 3 (high). See `docs/FINAL_TECHNICAL_REPORT.md`.
- Upload type is checked from the file's first bytes, not its name or the browser's type. Files are private and served as downloads.
- No automatic email retry. Retries are manual.
- No conversion rate by source (the site does not count visits).
