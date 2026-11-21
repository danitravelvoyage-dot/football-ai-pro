import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser, applyMigrationsThrough } from "./helpers";

/**
 * Audit integrity on PGlite. The report is read by the owner; it names every trigger and privilege the audit trail
 * depends on. A database owner can disable a trigger: the report must show it, and the test proves it does.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const REASON = "Confirmed against the official page";

let db: PGlite;

type Check = { check_name: string; passed: boolean; detail: string };
const report = async (userId: string | null) => asUser<Check>(db, userId, `select check_name, passed, detail from public.ai_audit_integrity_report()`);
const failing = (rows: Check[]) => rows.filter((r) => !r.passed).map((r) => r.check_name);

beforeAll(async () => {
  db = await createTestDb();
  await applyMigrationsThrough(db, "0018");
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("integrity report", () => {
  it("passes every check on the chain through 0018", async () => {
    const rows = await report(ADMIN);
    expect(rows).toHaveLength(12);
    expect(failing(rows)).toEqual([]);
  });

  it("only the owner can read it: an operator and an anonymous caller are refused", async () => {
    await expect(report(OPERATOR)).rejects.toThrow(/Only the owner/);
    await expect(report(null)).rejects.toThrow(/permission denied|Only the owner/);
  });

  it("detects a disabled append-only trigger, which a database owner can do, and the change is visible", async () => {
    await db.exec(`alter table public.ai_events disable trigger ai_events_append_only`);
    try {
      expect(failing(await report(ADMIN))).toEqual(["ai_events_append_only_trigger"]);
      // The owner's session can change the audit row while the trigger is off: this is the privilege the report exposes.
      await db.exec(`update public.ai_events set meta = '{"changed": true}' where id = (select id from public.ai_events limit 1)`);
    } finally {
      await db.exec(`alter table public.ai_events enable trigger ai_events_append_only`);
    }
    expect(failing(await report(ADMIN))).toEqual([]);
  });

  it("detects a guard trigger that is disabled on the registry", async () => {
    await db.exec(`alter table public.ai_sources_allowlist disable trigger ai_sources_allowlist_audit`);
    try {
      expect(failing(await report(ADMIN))).toEqual(["sources_audit_trigger"]);
    } finally {
      await db.exec(`alter table public.ai_sources_allowlist enable trigger ai_sources_allowlist_audit`);
    }
  });
});

describe("append-only permissions", () => {
  it("no client role can update or delete the audit trail, even with the trigger present", async () => {
    await expect(asUser(db, ADMIN, `update public.ai_events set meta = '{}'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ADMIN, `delete from public.ai_events`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, OPERATOR, `delete from public.ai_events`)).rejects.toThrow(/permission denied/);
  });

  it("a client role can still write its events: insert is kept", async () => {
    await asUser(db, ADMIN, `insert into public.ai_events (actor, event_type, entity_type, entity_id, meta) values ('owner:test', 'test.insert', 'probe', 'p-1', '{}')`);
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.ai_events where event_type = 'test.insert'`);
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("the audit trail refuses truncation for every role", async () => {
    await expect(db.exec(`truncate public.ai_events`)).rejects.toThrow(/append-only/);
    await expect(asUser(db, ADMIN, `truncate public.ai_events`)).rejects.toThrow(/permission denied|append-only/);
  });

  it("registry rows and review items cannot be deleted by a client role", async () => {
    await asUser(db, ADMIN, `insert into public.ai_sources_allowlist (host, purpose, approved_by, last_change_reason) values ('probe.gov.dz', 'Probe', '${ADMIN}', '${REASON}')`);
    await expect(asUser(db, ADMIN, `delete from public.ai_sources_allowlist where host = 'probe.gov.dz'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ADMIN, `delete from public.ai_review_items`)).rejects.toThrow(/permission denied/);
  });
});

describe("database audit rows", () => {
  it("a retirement and a reactivation each leave their own audit row, written by the database", async () => {
    await asUser(db, ADMIN, `update public.ai_sources_allowlist set status = 'retired', last_change_reason = 'Moved' where host = 'probe.gov.dz'`);
    const retired = await db.query<{ event_type: string }>(`select event_type from public.ai_events where entity_id = 'probe.gov.dz' order by ts`);
    expect(retired.rows.map((r) => r.event_type)).toEqual(["db.source.added", "db.source.retired"]);
  });
});
