import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser, applyMigrationsThrough } from "./helpers";

/**
 * Migration 0018 on PGlite (local, disposable only). Guards for review items and registry rows, owner-only writes,
 * no delete for any client role, and the audit rows the triggers write.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const ITEM = "00000000-0000-0000-0000-0000000000d1";
const LEAD = "00000000-0000-0000-0000-0000000000e1";
const REASON = "Confirmed against the official page";

let db: PGlite;
const exec = (sql: string) => db.exec(sql);
const count = async (sql: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).rows[0]?.n);

beforeAll(async () => {
  db = await createTestDb();
  await applyMigrationsThrough(db, "0018");
  await exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_leads (id, label, source, interest, stage, created_by)
      values ('${LEAD}', 'Enquiry', 'manual', 'visa', 'new', 'owner-1');
    insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at)
      values ('${ITEM}', 'crm_transition', 'lead-1', 'Move needs approval', now() + interval '7 days');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("review item guard and audit", () => {
  it("records one decision, with the version rising by one, and the database writes its audit row", async () => {
    await exec(`update public.ai_review_items set status = 'approved', decided_by = 'owner-1', decided_at = now(), decision_reason = 'Checked', version = 2 where id = '${ITEM}'`);
    const row = await db.query<{ status: string; version: number }>(`select status, version from public.ai_review_items where id = '${ITEM}'`);
    expect(row.rows[0]).toEqual({ status: "approved", version: 2 });
    const audit = await db.query<{ event_type: string; meta: { previous_status: string; new_status: string } }>(
      `select event_type, meta from public.ai_events where entity_id = '${ITEM}' and event_type = 'db.review.decided'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.meta).toMatchObject({ previous_status: "open", new_status: "approved" });
  });

  it("refuses any change to a decided item", async () => {
    await expect(exec(`update public.ai_review_items set status = 'rejected', decided_by = 'owner-2', decided_at = now(), decision_reason = 'Changed', version = 3 where id = '${ITEM}'`)).rejects.toThrow(/cannot change/);
  });

  it("refuses a decision that skips a version", async () => {
    const id = "00000000-0000-0000-0000-0000000000d2";
    await exec(`insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at) values ('${id}', 'escalated_claim', 'c-1', 'Claim', now() + interval '7 days')`);
    await expect(exec(`update public.ai_review_items set status = 'rejected', decided_by = 'owner-1', decided_at = now(), decision_reason = 'Skipped', version = 5 where id = '${id}'`)).rejects.toThrow(/version must rise by one/);
  });

  it("refuses to move an item back to open, and refuses changes to what is being approved", async () => {
    const id = "00000000-0000-0000-0000-0000000000d3";
    await exec(`insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at, payload) values ('${id}', 'held_answer', 'q-3', 'Held', now() + interval '7 days', '{"answer":"a"}')`);
    await expect(exec(`update public.ai_review_items set payload = '{"answer":"changed"}' where id = '${id}'`)).rejects.toThrow(/Only the decision/);
    await expect(exec(`update public.ai_review_items set status = 'open', version = 2 where id = '${id}'`)).rejects.toThrow(/only move to a decision/);
  });

  it("requires a decider and a decision time once an item is decided", async () => {
    const id = "00000000-0000-0000-0000-0000000000d4";
    await exec(`insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at) values ('${id}', 'rejected_proposal', 'task-4', 'Rejected', now() + interval '7 days')`);
    await expect(exec(`update public.ai_review_items set status = 'rejected', version = 2 where id = '${id}'`)).rejects.toThrow(/review_items_decided/);
  });

  it("no client role can delete a review item", async () => {
    await expect(asUser(db, ADMIN, `delete from public.ai_review_items where id = '${ITEM}'`)).rejects.toThrow(/permission denied/);
    expect(await count(`select 1 from public.ai_review_items where id = '${ITEM}'`)).toBe(1);
  });

  it("an operator cannot decide review items", async () => {
    await expect(asUser(db, OPERATOR, `update public.ai_review_items set status = 'rejected', decided_by = 'op', decided_at = now(), decision_reason = 'x', version = 2 where id = '${ITEM}'`)).resolves.toEqual([]);
    expect((await db.query<{ status: string }>(`select status from public.ai_review_items where id = '${ITEM}'`)).rows[0]?.status).toBe("approved");
  });
});

describe("lead version", () => {
  it("bumps the version on every update, whatever the caller writes", async () => {
    await exec(`update public.ai_leads set label = 'Renamed', version = 50 where id = '${LEAD}'`);
    const row = await db.query<{ version: number }>(`select version from public.ai_leads where id = '${LEAD}'`);
    expect(row.rows[0]?.version).toBe(2);
  });
});

describe("source registry guard", () => {
  it("refuses a source row without a reason, on insert and on update", async () => {
    await expect(exec(`insert into public.ai_sources_allowlist (host, purpose) values ('no-reason.gov.dz', 'Visa rules')`)).rejects.toThrow(/needs a reason/);
    await exec(`insert into public.ai_sources_allowlist (host, purpose, last_change_reason) values ('legacy-host.dz', 'Old source', 'Added by the owner')`);
    await expect(exec(`update public.ai_sources_allowlist set purpose = 'New' where host = 'legacy-host.dz'`)).rejects.toThrow(/its own reason/);
    await expect(exec(`update public.ai_sources_allowlist set purpose = 'New', last_change_reason = 'Added by the owner' where host = 'legacy-host.dz'`)).rejects.toThrow(/its own reason/);
  });

  it("gives existing hosts safe defaults: other category, all jurisdictions, active, no expiry", async () => {
    const row = await db.query<Record<string, unknown>>(`select category, jurisdiction, status, expires_at, version from public.ai_sources_allowlist where host = 'legacy-host.dz'`);
    expect(row.rows[0]).toEqual({ category: "other", jurisdiction: "all", status: "active", expires_at: null, version: 1 });
  });

  it("the owner can add, and the change is audited by the database with the reason", async () => {
    await asUser(db, ADMIN, `insert into public.ai_sources_allowlist (host, purpose, last_change_reason) values ('owner-added.gov.dz', 'Visa rules', '${REASON}')`);
    const audit = await db.query<{ event_type: string; meta: { reason: string; version: number } }>(
      `select event_type, meta from public.ai_events where entity_id = 'owner-added.gov.dz'`,
    );
    expect(audit.rows[0]).toMatchObject({ event_type: "db.source.added", meta: { reason: REASON, version: 1 } });
  });

  it("a stale version matches nothing, and a current version bumps it", async () => {
    const current = await asUser<{ version: number }>(db, ADMIN, `update public.ai_sources_allowlist set purpose = 'Visa rules v2', last_change_reason = 'Wording confirmed', version = 9 where host = 'owner-added.gov.dz' and version = 1 returning version`);
    expect(current).toEqual([{ version: 2 }]);
    const stale = await asUser(db, ADMIN, `update public.ai_sources_allowlist set status = 'disabled', last_change_reason = 'Stale attempt' where host = 'owner-added.gov.dz' and version = 1 returning host`);
    expect(stale).toHaveLength(0);
  });

  it("the approver and the host of a row cannot change", async () => {
    await expect(exec(`update public.ai_sources_allowlist set approved_by = '${OPERATOR}', last_change_reason = '${REASON} 2' where host = 'owner-added.gov.dz'`)).rejects.toThrow(/host and the approver of a source cannot change/);
    await expect(exec(`update public.ai_sources_allowlist set host = 'renamed.gov.dz', last_change_reason = '${REASON} 3' where host = 'owner-added.gov.dz'`)).rejects.toThrow(/host and the approver of a source cannot change/);
  });

  it("no client role can delete a source, including the owner", async () => {
    await expect(asUser(db, ADMIN, `delete from public.ai_sources_allowlist where host = 'owner-added.gov.dz'`)).rejects.toThrow(/permission denied/);
    expect(await count(`select 1 from public.ai_sources_allowlist where host = 'owner-added.gov.dz'`)).toBe(1);
  });

  it("an operator can read the registry but cannot change it", async () => {
    const rows = await asUser(db, OPERATOR, `select host from public.ai_sources_allowlist where host = 'owner-added.gov.dz'`);
    expect(rows).toHaveLength(1);
    await expect(asUser(db, OPERATOR, `insert into public.ai_sources_allowlist (host, purpose, last_change_reason) values ('op.gov.dz', 'x y', '${REASON}')`)).rejects.toThrow();
  });

  it("removal is a terminal status: the row stays, and nothing changes it afterwards", async () => {
    await asUser(db, ADMIN, `update public.ai_sources_allowlist set status = 'removed', last_change_reason = 'Not used any more' where host = 'owner-added.gov.dz'`);
    const removed = await db.query<{ status: string }>(`select status from public.ai_sources_allowlist where host = 'owner-added.gov.dz'`);
    expect(removed.rows[0]?.status).toBe("removed");
    await expect(exec(`update public.ai_sources_allowlist set status = 'active', last_change_reason = '${REASON}' where host = 'owner-added.gov.dz'`)).rejects.toThrow(/removed source cannot change/);
    const audit = await db.query<{ event_type: string }>(`select event_type from public.ai_events where entity_id = 'owner-added.gov.dz' order by ts`);
    expect(audit.rows.map((r) => r.event_type)).toEqual(["db.source.added", "db.source.changed", "db.source.removed"]);
  });

  it("the audit trail for sources cannot be rewritten or deleted", async () => {
    await expect(exec(`update public.ai_events set meta = '{}' where entity_id = 'owner-added.gov.dz'`)).rejects.toThrow(/append-only/);
    await expect(exec(`delete from public.ai_events where entity_id = 'owner-added.gov.dz'`)).rejects.toThrow(/append-only/);
  });
});
