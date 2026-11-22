# GLOBALTRAVELASSI: final database report

Date: 22 November 2026. **No migration was added, changed or applied in this pass.** No database was accessed except the in-memory test databases (PGlite) and the test-only fake API used by the browser test.

## Migrations

| File | Purpose | Applied where |
|---|---|---|
| `0001_init.sql`, `seed.sql` | Base schema and six starter services | **Production**, 19 November (owner, SQL editor). Unchanged since: byte-identical to the pushed version. |
| `0002`–`0018` | AI back office | Nowhere (deferred) |
| `0019_manual_payments.sql` | Historical payment tables; required by `0022` | Nowhere |
| `0020_customer_hardening.sql` | Grants, disabled accounts, document rules, request language | Nowhere |
| `0021_customer_email_notifications.sql` | Email log, queue, delivery record, retry | Nowhere |
| `0022_remove_payment_workflow.sql` | Forward-only payment removal; history kept | Nowhere |
| `0023_crm_attribution_requests.sql` | Lead source, CRM fields, activity log, rate limits; deactivates two old services | Nowhere |
| `seed_catalog.sql` | Five more services, empty prices | Nowhere |

- **Launch order:** `0001` → `seed.sql` → `0019` → `0020` → `0021` → `0022` → `0023` → `seed_catalog.sql` (`docs/MIGRATIONS.md`). Production already has the first two.
- **Integrity:** `docs/migrations/manifest.json` holds 29 SHA-256 entries, all matching (checked in the recovery pass today; no migration file has changed since).
- **Rollback:** `docs/migrations/0018_rollback.sql` … `0023_rollback.sql`.

## Features added in this pass and their data

| Feature | Reads | Writes | Schema change |
|---|---|---|---|
| Lead qualification | `applications` (travel date, WhatsApp, travel history, status, last contact, created), `services.category`, `documents.doc_type` and `verified` | none (computed on each page view) | none |
| Document checklist | `services.category`, `documents` | none | none |
| Admin pagination | `applications` and `profiles` with exact counts | none | none |
| Customer search | `profiles` (`full_name`, `email`, `whatsapp`, by `ilike`) | none | none |
| Admin theme | none (a browser cookie) | none | none |

The request list now embeds `documents(doc_type, verified)` per request. Row Level Security lets admins read all documents, and customers only their own.

## Production data notes (from records; not checked in the database)

- Services and prices were entered in DZD in November. With the current code, any price set shows on the site; an empty price shows "Price on request".
- The services "Organized European trips" and "Travel consultation" stay active in production until `0023` is applied, which deactivates them without deleting them.
- Historical payment rows (from `0001`'s `payments` table) are preserved by `0022`.

## Database tests (PGlite, real Postgres rules)

24 test files in `tests/db/` passed in the final run, including:
- the migration chain and the customer-only sequence
- Row Level Security
- payment removal with data preserved
- CRM rules and the append-only activity log
- the email queue
- rollback verification
- the AI back-office tables

The only change to them is the 20-second timeout (see the test report).

## Rules followed

- No production database access, no migration applied anywhere.
- No migration file edited; no destructive change; historical data and migration history preserved.
