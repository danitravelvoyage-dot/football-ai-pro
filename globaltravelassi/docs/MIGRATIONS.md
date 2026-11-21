# Migrations

Applied by hand, in order, in the Supabase SQL editor of each project (staging first). Each file is listed in `docs/migrations/manifest.json` with its SHA-256; compare before applying.

## Customer-launch sequence

| Order | File | Depends on | Payment-related | Rollback |
|---|---|---|---|---|
| 1 | `supabase/migrations/0001_init.sql` | nothing | no | none (base schema) |
| 2 | `supabase/seed.sql` | 0001 | no | delete the seeded rows by hand if needed |
| 3 | `supabase/migrations/0019_manual_payments.sql` | 0001 | **yes**: creates the payment tables and functions | `docs/migrations/0019_rollback.sql` (refuses while payment-only rows exist) |
| 4 | `supabase/migrations/0020_customer_hardening.sql` | 0001 | no | `docs/migrations/0020_rollback.sql` |
| 5 | `supabase/migrations/0021_customer_email_notifications.sql` | 0001, 0019 (see below), 0020 | no | `docs/migrations/0021_rollback.sql` (keeps the log) |
| 6 | `supabase/migrations/0022_remove_payment_workflow.sql` | 0019 | removes the payment workflow; keeps all payment data | `docs/migrations/0022_rollback.sql` (see its notes) |
| 7 | `supabase/migrations/0023_crm_attribution_requests.sql` | 0001, 0019, 0020 | no | `docs/migrations/0023_rollback.sql` (data-preserving) |
| 8 | `supabase/seed_catalog.sql` | 0020 | no | deactivate the services in the admin dashboard |

### Why 0019 is still applied

0019 is the first payment migration, so it is payment-dependent. It is still applied, for two reasons. Its payment tables hold the history of anything recorded before the change, and 0022 is written against them: it revokes access on those tables and drops the payment functions by name. Applying 0022 without 0019 would therefore fail. The payment workflow itself is removed by 0022, and no code calls it.

Tested: `tests/db/customer-sequence.test.ts` applies exactly this sequence on an in-memory Postgres and checks the result. `tests/db/payment-removal-crm.test.ts` checks that payment data survives 0022.

## Not part of the launch

Migrations `0002` to `0018` belong to the AI back office (agents, approvals, scheduler, CRM for sales agents, competitor and marketing tables). They are deferred. Applying them is not needed for the customer site, and the AI admin pages need them. They are kept in the repository as history.

## Rules

- Never edit a migration that has been applied anywhere. Add a new one.
- Never drop a table or delete rows as part of a migration. The files in this repository follow that rule, and tests check it.
- Rollbacks restore behaviour, and are run only with the owner's approval.
- Before applying to any project, confirm it is the **staging** project.
