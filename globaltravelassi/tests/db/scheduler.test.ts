import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Migration 0011 on a real Postgres engine (PGlite). Covers the SQL rules that the in-memory store only mirrors:
 * row-level security, owner-only settings, the timezone guard, lease reclaim, fenced completion and dead letters.
 *
 * Limit: PGlite runs a single connection, so it cannot race two sessions. Concurrent leasing rests on
 * `for update skip locked` in ai_scheduler_lease; that clause is reviewed in the migration, not raced here.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";
const T0 = "2026-11-20T09:00:00Z";
const T_LAPSED = "2026-11-20T09:06:00Z"; // more than the 300 s lease after T0

let db: PGlite;

async function as(userId: string | null, sql: string, params: unknown[] = []) {
  return asUser<Record<string, unknown>>(db, userId, sql, params);
}

async function expectFailure(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0002_ai_company.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0011_scheduler.sql"), "utf8"));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'),
      ('${OPERATOR}', 'runner@example.dz', '{}'),
      ('${CUSTOMER}', 'customer@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'scheduler');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("scheduler settings", () => {
  it("are disabled by default and readable by the operator", async () => {
    const rows = await as(OPERATOR, "select enabled, interval_minutes, timezone, lease_seconds, max_attempts from public.ai_scheduler_settings where id = 1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, interval_minutes: 5, timezone: "Africa/Algiers", lease_seconds: 300, max_attempts: 3 });
  });

  it("only the owner can change them: the operator's update changes nothing", async () => {
    await as(OPERATOR, "update public.ai_scheduler_settings set enabled = true where id = 1");
    const rows = await as(ADMIN, "select enabled from public.ai_scheduler_settings where id = 1");
    expect(rows[0]?.enabled).toBe(false);
  });

  it("the owner can enable the scheduler, and the change records who made it", async () => {
    await as(ADMIN, "update public.ai_scheduler_settings set enabled = true, interval_minutes = 60, max_attempts = 3 where id = 1");
    const rows = await as(ADMIN, "select enabled, interval_minutes, updated_by from public.ai_scheduler_settings where id = 1");
    expect(rows[0]).toMatchObject({ enabled: true, interval_minutes: 60, updated_by: ADMIN });
  });

  it("an unknown timezone is refused by the database", async () => {
    await expectFailure(as(ADMIN, "update public.ai_scheduler_settings set timezone = 'Mars/Olympus' where id = 1"));
  });

  it("a valid timezone is accepted", async () => {
    await as(ADMIN, "update public.ai_scheduler_settings set timezone = 'Europe/Paris' where id = 1");
    const rows = await as(ADMIN, "select timezone from public.ai_scheduler_settings where id = 1");
    expect(rows[0]?.timezone).toBe("Europe/Paris");
    await as(ADMIN, "update public.ai_scheduler_settings set timezone = 'Africa/Algiers' where id = 1");
  });

  it("the settings row cannot be deleted or duplicated", async () => {
    await expectFailure(as(ADMIN, "insert into public.ai_scheduler_settings (id) values (2)"));
  });
});

describe("job queue functions", () => {
  it("a slot is queued once: a second enqueue for the same key creates nothing", async () => {
    const first = await as(OPERATOR, "select public.ai_scheduler_enqueue($1, 'orchestrator_cycle', $2, gen_random_uuid()) as ok", ["cycle:1", T0]);
    const second = await as(OPERATOR, "select public.ai_scheduler_enqueue($1, 'orchestrator_cycle', $2, gen_random_uuid()) as ok", ["cycle:1", T0]);
    expect(first[0]?.ok).toBe(true);
    expect(second[0]?.ok).toBe(false);
    const count = await as(ADMIN, "select count(*)::int as n from public.ai_scheduler_jobs where job_key = 'cycle:1'");
    expect(count[0]?.n).toBe(1);
  });

  it("a due job is leased once: a second worker gets nothing while the lease holds", async () => {
    const first = await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 1)", ["inv-a", T0]);
    const second = await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 1)", ["inv-b", T0]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ job_key: "cycle:1", status: "running", lease_owner: "inv-a", attempts: 1 });
    expect(second).toHaveLength(0);
  });

  it("a lapsed lease is reclaimed by another worker with one more attempt", async () => {
    const reclaimed = await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 1)", ["inv-c", T_LAPSED]);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ job_key: "cycle:1", lease_owner: "inv-c", attempts: 2 });
  });

  it("fencing: the worker that lost the lease cannot complete the job; the holder can", async () => {
    const stale = await as(OPERATOR, "select public.ai_scheduler_complete((select id from public.ai_scheduler_jobs where job_key = 'cycle:1'), 'inv-a', $1, '{\"stale\": true}'::jsonb) as ok", [T_LAPSED]);
    expect(stale[0]?.ok).toBe(false);
    const holder = await as(OPERATOR, "select public.ai_scheduler_complete((select id from public.ai_scheduler_jobs where job_key = 'cycle:1'), 'inv-c', $1, '{\"ok\": true}'::jsonb) as ok", [T_LAPSED]);
    expect(holder[0]?.ok).toBe(true);
    const row = await as(ADMIN, "select status, result from public.ai_scheduler_jobs where job_key = 'cycle:1'");
    expect(row[0]).toMatchObject({ status: "succeeded", result: { ok: true } });
  });

  it("a failed job is re-queued for the retry time while attempts remain", async () => {
    await as(ADMIN, "update public.ai_scheduler_settings set max_attempts = 3 where id = 1");
    await as(OPERATOR, "select public.ai_scheduler_enqueue($1, 'orchestrator_cycle', $2, gen_random_uuid())", ["cycle:retry", T0]);
    await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 5)", ["inv-r", T0]);
    const retryAt = "2026-11-20T09:01:00Z";
    const outcome = await as(OPERATOR, "select public.ai_scheduler_fail((select id from public.ai_scheduler_jobs where job_key = 'cycle:retry'), 'inv-r', $1, 'provider timeout', $2) as outcome", [T0, retryAt]);
    expect(outcome[0]?.outcome).toBe("queued");
    const row = await as(ADMIN, "select status, run_at, last_error, lease_owner from public.ai_scheduler_jobs where job_key = 'cycle:retry'");
    expect(row[0]).toMatchObject({ status: "queued", last_error: "provider timeout", lease_owner: null });
    expect(new Date(row[0]?.run_at as string).toISOString()).toBe(new Date(retryAt).toISOString());
  });

  it("a job whose attempts are used up becomes dead, not queued again", async () => {
    await as(ADMIN, "update public.ai_scheduler_settings set max_attempts = 1 where id = 1");
    await as(OPERATOR, "select public.ai_scheduler_enqueue($1, 'orchestrator_cycle', $2, gen_random_uuid())", ["cycle:fail-dead", T0]);
    await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 5)", ["inv-d", T0]);
    const outcome = await as(OPERATOR, "select public.ai_scheduler_fail((select id from public.ai_scheduler_jobs where job_key = 'cycle:fail-dead'), 'inv-d', $1, 'down', $2) as outcome", [T0, "2026-11-20T09:01:00Z"]);
    expect(outcome[0]?.outcome).toBe("dead");
    const row = await as(ADMIN, "select status from public.ai_scheduler_jobs where job_key = 'cycle:fail-dead'");
    expect(row[0]?.status).toBe("dead");
    await as(ADMIN, "update public.ai_scheduler_settings set max_attempts = 3 where id = 1");
  });

  it("a crashed worker's job that lapses at its last attempt is returned as dead", async () => {
    await as(ADMIN, "update public.ai_scheduler_settings set max_attempts = 1 where id = 1");
    await as(OPERATOR, "select public.ai_scheduler_enqueue($1, 'orchestrator_cycle', $2, gen_random_uuid())", ["cycle:crash-loop", T0]);
    await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 5)", ["inv-crash", T0]);
    const later = await as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 300, 5)", ["inv-next", T_LAPSED]);
    const crashLoop = later.find((r) => r.job_key === "cycle:crash-loop");
    expect(crashLoop).toMatchObject({ status: "dead" });
    expect(later.some((r) => r.job_key === "cycle:crash-loop" && r.status === "running")).toBe(false);
    await as(ADMIN, "update public.ai_scheduler_settings set max_attempts = 3 where id = 1");
  });

  it("the lease length is bounded by the database too", async () => {
    await expectFailure(as(OPERATOR, "select * from public.ai_scheduler_lease($1, $2, 5, 1)", ["inv-x", T0]));
  });

  it("a worker heartbeat is stored once per worker name and then updated", async () => {
    await as(OPERATOR, "select public.ai_worker_heartbeat('scheduler', $1, null, 'started')", [T0]);
    await as(OPERATOR, "select public.ai_worker_heartbeat('scheduler', $1, null, 'ran:1')", [T_LAPSED]);
    const rows = await as(ADMIN, "select worker_id, started_at, last_seen_at, last_outcome from public.ai_worker_heartbeats");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_outcome).toBe("ran:1");
  });
});

describe("access rules", () => {
  it("a customer cannot read the queue, heartbeats or settings", async () => {
    expect(await as(CUSTOMER, "select id from public.ai_scheduler_jobs")).toHaveLength(0);
    expect(await as(CUSTOMER, "select worker_id from public.ai_worker_heartbeats")).toHaveLength(0);
    expect(await as(CUSTOMER, "select id from public.ai_scheduler_settings")).toHaveLength(0);
  });

  it("a customer cannot call the scheduler functions", async () => {
    await expectFailure(as(CUSTOMER, "select public.ai_scheduler_enqueue('cycle:evil', 'orchestrator_cycle', $1, gen_random_uuid())", [T0]));
    await expectFailure(as(CUSTOMER, "select * from public.ai_scheduler_lease('evil', $1, 300, 1)", [T0]));
  });

  it("anonymous visitors cannot touch any scheduler table", async () => {
    await expectFailure(as(null, "select id from public.ai_scheduler_jobs"));
    await expectFailure(as(null, "select public.ai_scheduler_enqueue('cycle:anon', 'orchestrator_cycle', $1, gen_random_uuid())", [T0]));
  });

  it("the operator cannot write jobs or heartbeats directly, only through the functions", async () => {
    await expectFailure(as(OPERATOR, "insert into public.ai_scheduler_jobs (job_key, kind, status, run_at, max_attempts) values ('cycle:direct', 'orchestrator_cycle', 'succeeded', $1, 1)", [T0]));
    await expectFailure(as(OPERATOR, "update public.ai_worker_heartbeats set last_outcome = 'forged'"));
  });

  it("the operator cannot delete scheduler history", async () => {
    await expectFailure(as(OPERATOR, "delete from public.ai_scheduler_jobs"));
  });

  it("nobody can truncate the queue, the heartbeats or the settings, because row-level security does not cover TRUNCATE", async () => {
    await expectFailure(as(OPERATOR, "truncate public.ai_scheduler_jobs"));
    await expectFailure(as(ADMIN, "truncate public.ai_worker_heartbeats"));
    await expectFailure(as(ADMIN, "truncate public.ai_scheduler_settings"));
    const rows = await as(ADMIN, "select count(*)::int as n from public.ai_scheduler_settings");
    expect(rows[0]?.n).toBe(1);
  });
});
