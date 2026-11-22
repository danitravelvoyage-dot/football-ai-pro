# GLOBALTRAVELASSI: final security report

Date: 22 November 2026. Scope: the working tree at the end of this pass. Not tested against a live Supabase project or the live website.

## Controls in place (verified by tests in this pass)

| Area | Control | Evidence |
|---|---|---|
| Authentication | Supabase Auth; session refreshed in `middleware.ts`; private areas redirect to sign-in | Smoke test: all 32 admin pages × 3 languages (96) redirect; admin browser test: anonymous visitor redirected |
| Authorization | `requireAdmin` / `requireCustomer` in pages; `adminClient()` role and active-flag check in every admin action; Row Level Security and `is_admin()` in the database | Browser: a customer is refused the admin area; `tests/db/rls.test.ts`; all 10 admin actions call `adminClient()` |
| Customer data isolation | Row Level Security; customers see only their rows and documents | `tests/db/rls.test.ts` (PGlite). The browser fake does **not** enforce it. |
| Input validation | Zod schemas on every form; server-side | `tests/validation.test.ts`, action tests |
| Request abuse | Honeypot; one-time token; rate limits per account and per hashed address (`consume_rate_limit`) | `tests/actions/request-protection.test.ts` |
| Files | Private bucket, 10 MB, PDF/JPEG/PNG; type checked from file content; uploads only into the customer's own folder while the request is `new` or `documents_required`; 120-second signed download | `tests/documents/signature.test.ts`, `tests/db/*` |
| Redirects | Same-site check on the sign-in return path | `tests/security/safe-redirect.test.ts` |
| CSP | Per-request nonce, **report-only** | Smoke: nonces present and unique; 0 violations public. Admin: 0 violations signed in. |
| CSV export | Formula injection neutralised | `tests/csv.test.ts` |
| Secrets | No key in the repository or its history; the browser receives only the public anon key; no `service_role` key | Pattern scan of all history in the recovery pass |
| Payments | No payment route, action or email; database refuses payment emails | `tests/launch/whatsapp-and-payments-removed.test.ts`, `tests/db/payment-removal-crm.test.ts` |
| WhatsApp | Click-to-chat links only; no API; nothing sent automatically | Code search; link builder tests |
| AI | `EXECUTE_EXTERNAL_ACTIONS = false`; owner-only approvals; personal-data guard before every model call; paid providers blocked without approval | `tests/ai/` (61 files, 791 tests) |

## Changes in this pass with a security effect

| Change | Effect |
|---|---|
| Unknown service and unmatched URLs answer 404 | Search engines and scanners no longer see 200 for missing pages. The rewrite carries the CSP and locale headers. |
| Lead qualification fairness rule | Only readiness signals are scored. Nationality, residence, employment and income are never inputs, and a test proves changing them does not change the result. |
| New cookie `gta_admin_theme` | Admin-only display preference: `light` or `dark`, no personal data, 1 year, SameSite=Lax. Read with a strict parser: anything but `dark` is `light`. Disclosed in the cookie notice (ar, fr, en) and `docs/PRIVACY_AND_COOKIES.md`. |
| Customer search on `profiles` | The search term is cleaned (`lib/pagination.ts`, `searchTerm`) so it cannot change the PostgREST filter. Tested. |
| Test-only fake Supabase | Lives in `tests/browser/`. It is used only by `npm run test:admin-browser`, builds into the separate `.next-qa` folder (git- and lint-ignored), and contains only synthetic data. It is never part of the application build. |
| `NEXT_DIST_DIR` | Changes only the build folder. Unset in every real environment. |

## Dependency advisories (`npm audit --omit=dev`, this pass)

| Package | Severity | Fix |
|---|---|---|
| `next` | moderate | `next@16` (major) |
| `postcss` (bundled by `next`) | high | through `next@16` (major) |
| `zod` | high | `zod@4` (major) |

Not fixed: the brief allows major upgrades only after compatibility analysis and full regression testing. This is a separate task. The current pins are `next` ~15.5.29 and `zod` 3.25.76.

## Remaining risks

1. **CSP is report-only.** Enforcement is an owner decision after staging shows no violations.
2. **`style-src 'unsafe-inline'`** remains, needed by inline style attributes such as the progress bars.
3. **Nothing has been validated on a live Supabase project.** Row Level Security has been tested in PGlite, not in the hosted project.
4. **The dependency advisories above.**
5. **Production runs an older version**, with admin-recorded payment tracking, until the new version is deployed after staging.
