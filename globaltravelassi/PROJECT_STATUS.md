# GLOBALTRAVELASSI: project status and audit

Status date: 2026-11-20. Branch: `feature/ai-marketing-command-center`. Local only. Nothing has been pushed or deployed.
No migration has been applied to any database.

## Verification (this change)

| Check | Result |
| --- | --- |
| `npm run lint` | passes, no warnings |
| `npm run typecheck` | passes |
| `npm test` (vitest) | 35 files, 500 tests, all passing (435 before this change) |
| `npm run build` | passes; `/api/ai/scheduler` and `/[locale]/admin/command-center/scheduler` compile |
| Live probe of the trigger on a production server | 401 with no or wrong bearer, 503 `not_configured` with the correct bearer and no worker credentials, 405 on GET, login redirect for the admin page when signed out |
| SQL tests (PGlite, real Postgres engine) | 21 scheduler tests, including RLS, timezone guard, lease reclaim, fencing, dead letters and TRUNCATE refusal |

Not verified: a live database with migrations 0002 to 0011 applied; two real database connections racing for a lease; an authenticated browser run of the scheduler page; a live AI provider.

## Architecture (summary)

- **Composition root** (`lib/ai/services.ts`): `buildAiServices(db)` builds every service on one database session. The admin uses the cookie session; the scheduler uses its operator session.
- **Orchestrator** (`lib/ai/orchestration/engine.ts`): a tick expires approvals, recovers stale running tasks, updates readiness, runs due tasks through the quality gate, and dispatches events. The tick report now includes expired approvals, recovered tasks, overdue tasks and event counts.
- **Scheduler** (`lib/ai/scheduler/`): a persistent queue with leases, fencing, retries, dead letters, heartbeats and owner-only settings. One pass runs one orchestration cycle per leased job. See `SCHEDULER.md`.
- **Approvals** (`lib/ai/approvals.ts`), **event bus** (`lib/ai/events/`), **shared context** (`lib/ai/context/`), **knowledge base** (`lib/ai/knowledge/`), **quality controller** (`lib/ai/quality/`), **business memory** (`lib/ai/memory/`), **observability** (`lib/ai/observability/`): unchanged in this change except as noted.
- **Trigger** (`app/api/ai/scheduler/route.ts`): an authenticated POST endpoint. The middleware exempts exactly this path from the locale redirect; the route checks the secret itself.
- **Worker** (`lib/ai/scheduler/worker.ts`): signs in as a dedicated operator account with the anon key. No service-role key is used anywhere in the repository (checked by search).

## Completed in this change

1. Persistent job queue with leases, `for update skip locked`, lapsed-lease reclaim, fenced completion and failure, dead letters after the attempt limit (migration 0011, not applied).
2. Scheduled execution in UTC epoch slots, with duplicate prevention through a unique slot key.
3. Automatic retries with backoff (1 to 15 minutes).
4. Crash recovery for both jobs (lapsed leases) and tasks (stale `running` tasks).
5. Approval expiry sweeping, event dispatch and overdue detection inside the cycle.
6. Worker heartbeats and health status: disabled, no recent worker, overdue work, healthy.
7. Owner-controlled settings with validation, owner-only writes and an audit trail of changed fields.
8. Monitoring: the scheduler figures on the monitor replace the former hard-coded "not built" status. Unavailable figures show as unavailable.
9. Admin page: `/[locale]/admin/command-center/scheduler`, in Arabic, French and English, responsive.
10. Documentation: `SCHEDULER.md`, `.env.example` entries (names and placeholders only).

## Modified files

- New: `lib/ai/scheduler/{schedule,store,supabase-store,service,worker,load}.ts`, `lib/actions/scheduler.ts`, `app/api/ai/scheduler/route.ts`, `app/[locale]/admin/command-center/scheduler/page.tsx`, `supabase/migrations/0011_scheduler.sql`, `SCHEDULER.md`, `PROJECT_STATUS.md`.
- Changed: `lib/ai/orchestration/engine.ts` (recovery, overdue, dispatch counts), `lib/ai/services.ts` (`buildAiServices`, scheduler wiring), `lib/ai/observability/{metrics,load}.ts`, `middleware.ts` (one exact exemption), `app/[locale]/admin/command-center/layout.tsx` (nav item), `lib/i18n/{en,fr,ar}.ts` (new block), `.env.example`.
- Tests: new `tests/ai/scheduler.test.ts`, `tests/ai/scheduler-route.test.ts`, `tests/ai/middleware-scheduler.test.ts`, `tests/db/scheduler.test.ts`; updated `tests/ai/observability.test.ts` (scheduler figures instead of "not built") and `tests/db/migration-validation.test.ts` (history now runs to 0011).

## Integration report

- Scheduler to orchestrator: the cycle calls `tick()`, so approvals, recovery, readiness, task execution and dispatch all run from the scheduler.
- Scheduler to event bus: dispatch counts appear in each cycle report and in the audit trail.
- Scheduler to approvals: expiry runs inside every tick; the expiry itself is still enforced by the approval service and the database.
- Scheduler to observability: health and dead-letter figures are read from the same rows the scheduler writes.
- Scheduler to authorization: the operator account is subject to the same RLS as every other AI table; settings are writable only by administrators.

## Security audit

Findings and status:

1. **Migrations 0002 to 0011 are not applied.** All database security findings below are verified only on PGlite. Priority: high, blocked by owner approval.
2. **Migration 0010 (append-only hardening) is not applied.** It blocks TRUNCATE on the audit and history tables and adds a row trigger to `ai_events`. Priority: high.
3. **TRUNCATE on the original customer tables (migration 0001) has not been reviewed.** Priority: medium. Needs a decision by the owner.
4. **Scheduler: TRUNCATE is revoked** on its three tables (verified). Scheduler writes go only through functions; direct writes are refused (verified).
5. **Scheduler: the trigger is authenticated** with a constant-time comparison of digests and no default secret (verified by unit tests and a live probe).
6. **Scheduler: error text stored in `last_error`** is limited to 200 characters but may include database text. Priority: low. Visible only to administrators and the operator.
7. **Scheduler: the operator account** can read and run the AI tables it already had access to. It cannot decide approvals, change settings or write heartbeats or jobs directly. Its password lives only in the host's environment.
8. **Middleware exemption** covers one exact path. Tests check that a path that merely starts with it is still redirected.
9. **No service-role key** appears anywhere in the repository (searched).
10. **Form pending state** and redirect behaviour were verified in an earlier session; not re-tested here.

## Remaining incomplete features

Priority order follows the brief's list.

- **Marketing command center (6):** dashboard exists; the redesign to the owner's reference design is not started. The reference video was not accessible.
- **Campaign management (7):** not started. Only the `ai_campaigns` table exists.
- **Content generation and approval (8):** content agents and approval gating exist. No provider is connected, and nothing is published.
- **Analytics and performance (9):** monitoring and observability exist. The analytics workflow uses deterministic aggregation only. No live data source.
- **Lead management and sales automation (10):** the sales workflow runs with the mock provider. No CRM integration.
- **Notifications and reporting (11):** not started. No notification or report module exists.
- **Admin dashboard and owner controls (12):** mostly built. Knowledge base create and edit forms are not built; the knowledge base is read-only in the dashboard.
- **Agents and business memory:** agents do not yet read business memory or quality feedback.
- **Scheduled reports:** would use the scheduler, but no report job kind exists yet.

## External blockers

1. Owner approval to apply migrations 0002 to 0011 to a non-production Supabase project, with a migration plan and a recovery plan.
2. An AI provider: a free local model (needs installation) or a hosted free tier (needs a key). No key has been provided, and no paid service is used.
3. An external trigger for the scheduler (see `SCHEDULER.md`).
4. An operator account for the scheduler, created in Supabase after migration.
5. A decision on revoking TRUNCATE on the original customer tables.
6. The branch to push to, and approval to push. Nothing has been pushed.
7. The owner's design reference video, or confirmation of the design direction.

## Completion

Estimated **about 45%** of planned platform features, by module count with partial modules counted at half weight. This is a judgement, not a measured figure: 10 of 17 modules are built and tested, 5 are partial, and 2 are not started.

## Recommended next priorities

1. Get the owner's approval to apply migrations to a staging project, then run the two-connection lease race and the browser checks for the scheduler page.
2. Configure one external trigger and an operator account in staging, and run the scheduler for a day before enabling it in production.
3. Connect one AI provider (local free model preferred) and run the agents through the quality gate with real output.
4. Build notifications and the scheduled owner report, using the scheduler's job kind mechanism.
5. Build campaign management on top of the existing workflow and approval engine.
6. Build knowledge base create and edit forms with the existing rules.
