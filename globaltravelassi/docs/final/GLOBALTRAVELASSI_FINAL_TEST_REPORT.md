# GLOBALTRAVELASSI: final test report

Date: 22 November 2026. Every number below comes from a run in this pass, on the working tree described in `GLOBALTRAVELASSI_FINAL_COMPLETION_REPORT.md`. Nothing ran against a live Supabase project, a live website or a real customer.

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` (in `npm run verify`) | 0 problems |
| Typecheck | `npm run typecheck` (in `npm run verify`) | 0 errors |
| Unit, integration and database | `npx vitest run` (in `npm run verify`) | **108 files passed, 1 skipped; 1,390 tests passed, 3 skipped** |
| Production build | `npm run build` (in `npm run verify`) | Success; `npm run verify` exit 0 |
| Public browser smoke | `npm run test:browser` | **31 of 31** |
| Signed-in admin browser test | `npm run test:admin-browser` | **26 of 26** |
| Live local model | `LOCAL_AI_LIVE=1 npx vitest run tests/local` | **3 of 3**, in two consecutive runs |

Baseline at the start of this pass: 1,359 passed, 2 failed (both timeouts), 3 skipped.

## Skipped tests

- `tests/local/live-inference.test.ts`, 3 tests: skipped in the normal run because they need a running local model. They were run separately with `LOCAL_AI_LIVE=1` and passed (see below).

## Test changes in this pass

| File | Change | Why |
|---|---|---|
| `vitest.config.mts` | `testTimeout` 5 s → 20 s | Two PGlite tests (`tests/db/rollback-0019.test.ts`) timed out at 6.2–6.6 s under the full parallel run. Alone they take 1.4–2.3 s. No assertion changed. |
| `tests/browser/smoke.mjs` | The unknown-slug check now requires status 404; a new check covers unmatched URLs | The old check documented a 200 status, which is now fixed |
| `tests/local/live-inference.test.ts` | The diagnostic step catches invalid JSON | A reply cut off at the token limit crashed the reporting step. The runtime check, which must refuse bad replies, is unchanged. |
| New: `tests/crm/insights.test.ts` (13) | Qualification tiers, next actions, follow-up timers, checklist states, determinism, and the fairness rule (nationality, residence, employment and income never change the result) | |
| New: `tests/admin/pagination.test.ts` (5) | Page parsing, ranges, links that keep filters, search-term cleaning | |
| New: `tests/admin/theme.test.ts` (4) | Palette defaults equal the Tailwind palette (public site unchanged); the dark theme is scoped to admin; cookie parsing | |
| New: `tests/actions/result-messages.test.ts` (4) | Every result code of the launch actions has a message in ar, fr and en | |
| New: `tests/services/slugs.test.ts` (3) | The middleware's slug list matches the service content; path parsing | |
| New: `tests/browser/admin.mjs`, `tests/browser/fake-supabase.mjs` | Signed-in admin and customer browser test | |

## Signed-in admin browser test (26 checks)

The harness builds a separate copy into `.next-qa` against a **test-only fake of the Supabase API**. It uses synthetic data: 32 profiles, 30 requests, 9 services, 3 documents, `example.test` addresses and placeholder numbers. It checks:

- **Access control:** an anonymous visitor is redirected to sign-in, and a customer is refused the admin area (`/en/dashboard?error=denied`).
- **Rendering:** 8 admin pages in each of ar, fr and en return 200, with the correct text direction and no page errors.
- **Request list:** 25 rows on page 1 of 2, a priority on every row, page 2 with 5 rows, the status filter (3 rows, "1–3 of 3"), and search by reference (1 row).
- **Request detail:** qualification and next step shown, and the checklist states correct (Checked, Uploaded but not checked, Missing).
- **A real write through the UI:** "Record the contact" sent a `PATCH applications` and a `POST crm_activity`. After a reload the qualification counts the contact.
- **Customers:** 25 rows of 32, page 1 of 2; search finds one customer.
- **Themes:**
  - light is the default
  - the switch applies at once and is remembered
  - dark panels in en and ar, with contrast 16.1:1 for titles and 10.0:1 for muted text
  - the public site ignores the admin cookie
- **Phone layout:** 0 px horizontal overflow at 390 px on 5 admin pages and on the Arabic dark detail page.
- **Customer request page (fr):** shows the usual documents with their states.
- **CSP:** 0 content-security-policy reports across all signed-in pages.

Screenshots (outside the repository): `/tmp/gta-admin-qa/`. I reviewed them visually for the English desktop and the Arabic phone in dark mode.

**Limits of this test:** the fake is not a database and does not enforce Row Level Security. Customer isolation and the database rules are tested against real Postgres rules on PGlite (`tests/db/rls.test.ts`, `tests/db/customer-sequence.test.ts`, `tests/db/payment-removal-crm.test.ts`), not in the browser.

## Live local model (`qwen2.5:0.5b`, Ollama, on this machine)

| Test | Result |
|---|---|
| Research task through the real adapter, gateway and agent runtime | Pass. The model's reply missed the required `sources` field. The runtime **refused** it with `OutputValidationError`, and no output was stored. |
| Agent question answered and reviewed by two reviewers | Pass (0.7–0.8 s) |
| Lead stage answered from the stored record, whatever the model says | Pass (0.8–1.0 s) |

The first attempt failed because Ollama returned HTTP 500 once while loading the model (its log records it). The gateway reported this correctly as a provider error. Both later runs passed 3 of 3.

## Not tested

- Any flow against a real Supabase project: sign-up email, storage upload, Row Level Security in the hosted database. Staging is required.
- Real email delivery: no SMTP is configured, and the brief forbids real customer emails.
- The live website: this container's network proxy blocks it.
- AI command-center pages with real data. They were rendered with empty data only (200, no errors).
