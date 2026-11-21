# Production launch checklist

Production comes after staging passes (`docs/staging/STAGING_RUNBOOK.md`, section 7). Every item marked **Owner** is a decision or action only the owner can take.

## Decisions

- [ ] **Owner:** launch scope is the customer website and admin dashboard. The AI back office (0002–0018) stays off.
- [ ] **Owner:** approve applying 0019, 0020, 0021 and `seed_catalog.sql` to production, after a backup. Check what 0001 state the live project is in first, read-only.
- [ ] **Owner:** set real prices for each service, and deactivate `european-trips` and `travel-consultation` if they are not offered.
- [ ] **Owner:** enter the **real** payment instructions (USDT address and network, BaridiMob RIP, RedotPay details) in all three languages. Have a second person check each address character by character.
- [ ] **Owner:** choose the SMTP provider and sending address. Configure SPF, DKIM and DMARC.
- [ ] **Owner:** decide on CSP enforcement after staging shows no violations.
- [ ] **Owner:** privacy page content. It must mention the emails and the document storage.

## Configuration (hosting environment, never in git)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (https, no trailing slash), `NEXT_PUBLIC_WHATSAPP_NUMBER`.
- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, optionally `EMAIL_REPLY_TO`. Set `EMAIL_DELIVERY_ENABLED=true` last.
- [ ] No `service_role` key anywhere. The app does not need it.
- [ ] Supabase Auth: email confirmation on, custom SMTP set, templates pasted, redirect URLs limited to the production domain.

## Before switching traffic

- [ ] `npm run verify` exits 0 on the release commit. `npm run test:browser` passes.
- [ ] Database backup taken and a restore tested (see `docs/migrations/0018_backup_procedure.md` for the method).
- [ ] The first owner account is created and promoted (runbook, section 2).
- [ ] One real end-to-end run with the owner's own customer account: request, document, proof, rejection, approval, and the emails.

## After launch (first week)

- [ ] Check **Admin → Customer emails** daily for failed or long-pending rows.
- [ ] Check **Admin → Payments** for unsubmitted proofs.
- [ ] Watch the hosting logs for errors and for `customer email ...` lines.

## Known accepted risks

- `style-src 'unsafe-inline'` in the CSP (documented).
- Production dependency advisories in `zod` 3 (memory use on oversized collections) and in the `postcss` bundled with Next 15. The fixes are major upgrades (zod 4, Next 16) that need their own change and testing.
- Document type is checked from the browser's declared type, not the file content. Files are private and served as downloads.
- No automatic email retry. Retries are manual.
