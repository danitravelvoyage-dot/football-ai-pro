# Autonomous scheduler

The scheduler runs the AI company's orchestration cycle on a schedule: it expires approvals whose time has run out,
recovers tasks left behind by an interrupted worker, updates readiness, runs due tasks and delivers queued events.

## Status

- **Built and tested:** the job queue, leases, retries, crash recovery, duplicate prevention, owner settings,
  heartbeats, health figures and the trigger endpoint. See the test list below.
- **Not running anywhere yet.** The scheduler runs only when something calls `POST /api/ai/scheduler`.
  Nothing in this repository calls it on a timer. An external trigger must be configured (see *Trigger requirements*).
- **Database migration 0011 is not applied.** It needs owner approval and a non-production Supabase project first.

## How one pass works

Each call to the trigger:

1. records a heartbeat for the scheduler;
2. if the scheduler is enabled, queues the current time slot once. A slot key is unique, so repeated calls in the same slot queue nothing new;
3. leases up to three due jobs. A job whose lease lapsed is taken over by the next worker. A job whose lease lapsed after its last allowed attempt becomes a dead letter;
4. runs one orchestration cycle per leased job and records the result. A failed cycle is re-queued with backoff (1, 2, 4 … minutes, capped at 15). When the attempts are used up the job becomes a dead letter.

Every step writes an audit event (`scheduler.job_enqueued`, `scheduler.job_started`, `scheduler.job_succeeded`,
`scheduler.job_failed`, `scheduler.job_dead_lettered`, `scheduler.lease_reclaimed`, `scheduler.lease_lost`,
`scheduler.settings_changed`) and the orchestrator's own events (`task.recovered`, `task.recovery_failed`, `approval.expired`).

## Guarantees and how they are enforced

| Property | Where it is enforced | Tested by |
| --- | --- | --- |
| Scheduled execution | `slotFor` (UTC epoch buckets) and `ai_scheduler_enqueue` | `tests/ai/scheduler.test.ts`, `tests/db/scheduler.test.ts` |
| Duplicate jobs | unique `job_key` per slot | both suites above |
| Concurrent workers | `ai_scheduler_lease` takes rows with `for update skip locked`; the in-memory store is serialised per call | unit tests; the SQL race itself is **not** exercised (see Limits) |
| Crash recovery | lapsed leases are reclaimed; stale `running` tasks are recovered by the engine | unit tests |
| Crash loops | a job that lapses at its last attempt becomes dead, never runs again | unit + DB tests |
| Fencing | `complete` and `fail` require the current lease owner | unit + DB tests |
| Retries | backoff in `retryDelayMs`, attempts counted on every lease | unit tests |
| Approval expiry | the cycle calls the approval engine's expiry sweep | `tests/ai/scheduler.test.ts` |
| Event dispatch | the cycle calls the event bus | `tests/ai/scheduler.test.ts` |
| Timezone safety | slots are UTC; the owner's timezone only changes display; the database rejects unknown zone names | unit + DB tests |
| Owner-only settings | `updateSettings` refuses non-owners; RLS allows only administrators to update the settings row | unit + DB tests |
| Persistent state | jobs, heartbeats and settings are rows; a new process continues from them | `persistent state` unit test |
| Trigger authentication | bearer secret compared as SHA-256 digests in constant time; no default secret; refuses below 32 characters | `tests/ai/scheduler-route.test.ts` and a live probe |

## Notices from the scheduler

The owner's inbox receives these notices from the scheduler (see `lib/ai/notifications/`):

- **Scheduler not running** (critical, once per day). Raised by the watchdog endpoint, not by the scheduler itself.
- **Owner report** (information, or warning when something needs attention). Written once per day after a run.
- **Overdue scheduled work** (warning, once per day). Raised after a run when queued slots are past their grace period.
- **Daily agent summary** (info, or warning when an agent's failure rate is 25% or more). Written by the cycle once per day.
- **Terminal task failure** (critical, once per task). Raised by the orchestrator when a task fails for good.

**Watchdog.** `POST /api/ai/scheduler/watchdog` (same bearer secret) checks the scheduler's heartbeat from outside the
scheduler. When no run has been seen while the scheduler is enabled, it writes a critical *Scheduler not running*
notice, once a day. Call it from a second external trigger on its own schedule.

The owner report is also written once a day after a scheduler run, with runs, failures, unread notices and scheduler status.

Limit: a worker that never runs cannot report its own absence from inside the scheduler. The "no recent worker" status appears on the
scheduler and monitor pages, but no notice is sent for it yet. An independent check (for example a second external
cron that reads the status) is needed for that case.

## Owner settings

Open **Admin → Command center → Scheduler**. The owner can:

- enable or disable the scheduler (disabled by default);
- set the slot interval (1–1440 minutes);
- set the display timezone (an IANA name such as `Africa/Algiers`);
- set the lease length (60–3600 seconds) and the attempts per slot (1–10).

The page also shows the status, queued and overdue slots, dead letters, dead event deliveries, the last worker run,
recent slots and the workers that have reported.

## Trigger requirements

To make the scheduler run in production, all of the following are needed. None is configured yet.

1. **Migration 0011 applied** to the target Supabase project, after owner approval.
2. **An operator account.** Create a normal Supabase user for the scheduler, then register it:

   ```sql
   insert into public.ai_operators (user_id, label) values ('<user-uuid-of-the-scheduler-account>', 'scheduler');
   ```

   The scheduler signs in as this user with the anon key. It never uses a service-role key. Row-level security applies to it
   exactly as it does to the owner: it cannot decide approvals and cannot change settings.
3. **Environment variables** on the host (names only; values are never committed):
   - `AI_SCHEDULER_SECRET`: at least 32 random characters. Generate it with a password manager or `openssl rand -base64 48`.
   - `AI_WORKER_EMAIL` and `AI_WORKER_PASSWORD`: the scheduler account's credentials.
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: already required by the site.
4. **An external trigger** that sends the request on an interval no longer than the slot interval. Any scheduler that can
   send an HTTPS POST with a header will do (a hosting provider's cron, a free cron service, or a GitHub Actions schedule).
   Example request:

   ```bash
   curl -X POST "https://YOUR-SITE/api/ai/scheduler" -H "Authorization: Bearer $AI_SCHEDULER_SECRET"
   ```

   Expected responses: `200` with counts; `401` for a missing or wrong secret; `503` with `not_configured` when a variable is missing;
   `500` with `run_failed` when a pass fails (details are in the server log, not in the response).
5. **Owner settings** enabled on the scheduler page.

Until all five are in place, the scheduler does nothing, and the status page shows *Disabled* or *No recent worker*.

## Limits (stated plainly)

- The live race between two database connections has **not** been exercised. The lease relies on `for update skip locked`.
  Verifying that needs a real Postgres test with two connections (for example a staging project).
- A task stuck in `running` is recovered only after 15 minutes without progress. A genuinely slow model call that lasts longer than
  that could be started a second time. The 15-minute value is a constant (`STALE_RUNNING_MS` in `lib/ai/orchestration/engine.ts`).
- A failed cycle stores the first 200 characters of the error in `last_error`. This is visible to administrators and the operator.
  Database text could appear there, so review it before sharing screenshots.
- The provider is still the mock provider unless an AI provider is configured. Scheduled runs therefore produce mock output.

## Files

- `lib/ai/scheduler/schedule.ts`: pure rules (slots, backoff, overdue and stale checks, settings validation).
- `lib/ai/scheduler/store.ts`: the store contract and the in-memory store.
- `lib/ai/scheduler/supabase-store.ts`: the Supabase store, which calls the SQL functions.
- `lib/ai/scheduler/service.ts`: the scheduler service (runs, settings, health).
- `lib/ai/scheduler/worker.ts`: one pass as the operator account (server only).
- `lib/ai/scheduler/load.ts`: read-only status for the admin page.
- `lib/actions/scheduler.ts`: the owner's settings action.
- `app/api/ai/scheduler/route.ts`: the trigger endpoint.
- `supabase/migrations/0011_scheduler.sql`: the queue, heartbeats, settings and functions (not applied).
- `lib/ai/notifications/*` and `supabase/migrations/0012_owner_notifications.sql`: the owner inbox (not applied).
- `app/api/ai/scheduler/watchdog/route.ts` and `lib/ai/scheduler/auth.ts`: the independent watchdog and the shared trigger check.
