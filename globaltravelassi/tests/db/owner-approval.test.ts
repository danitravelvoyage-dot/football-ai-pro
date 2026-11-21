import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Migration 0018 on PGlite (local only, never a real project). Guard rules for review items, the lead version rule,
 * source metadata defaults, and that the rollback script removes exactly what 0018 added.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ITEM = "00000000-0000-0000-0000-0000000000d1";
const LEAD = "00000000-0000-0000-0000-0000000000e1";

let db: PGlite;
const exec = (sql: string) => db.exec(sql);
const load = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

beforeAll(async () => {
  db = await createTestDb();
  for (const f of ["0002_ai_company.sql", "0015_crm_sales.sql", "0018_owner_approval_center.sql"]) {
    await exec(load(`supabase/migrations/${f}`));
  }
  await exec(`
    insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'owner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_leads (id, label, source, interest, stage, created_by)
      values ('${LEAD}', 'Enquiry', 'manual', 'visa', 'new', 'owner-1');
    insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at)
      values ('${ITEM}', 'crm_transition', 'lead-1', 'Move needs approval', now() + interval '7 days');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("review item guard", () => {
  it("lets the owner record one decision with the version rising by one", async () => {
    await exec(`update public.ai_review_items set status = 'approved', decided_by = 'owner-1', decided_at = now(), decision_reason = 'Checked', version = 2 where id = '${ITEM}'`);
    const row = await db.query<{ status: string; version: number }>(`select status, version from public.ai_review_items where id = '${ITEM}'`);
    expect(row.rows[0]).toEqual({ status: "approved", version: 2 });
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

  it("refuses delete and truncate to the application role", async () => {
    await asUser(db, ADMIN, `delete from public.ai_review_items where id = '${ITEM}'`).catch(() => undefined);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.ai_review_items where id = '${ITEM}'`);
    expect(left.rows[0]?.n).toBe(1);
  });
});

describe("lead version", () => {
  it("bumps the version on every update, whatever the caller writes", async () => {
    await exec(`update public.ai_leads set label = 'Renamed', version = 50 where id = '${LEAD}'`);
    const row = await db.query<{ version: number }>(`select version from public.ai_leads where id = '${LEAD}'`);
    expect(row.rows[0]?.version).toBe(2);
  });
});

describe("source metadata", () => {
  it("gives existing hosts safe defaults: other category, all jurisdictions, active, no expiry", async () => {
    await exec(`insert into public.ai_sources_allowlist (host, purpose) values ('legacy-host.dz', 'Old source')`);
    const row = await db.query<Record<string, unknown>>(`select category, jurisdiction, status, expires_at from public.ai_sources_allowlist where host = 'legacy-host.dz'`);
    expect(row.rows[0]).toEqual({ category: "other", jurisdiction: "all", status: "active", expires_at: null });
  });

  it("bumps the registry version on every change, and a stale version matches nothing", async () => {
    await exec(`insert into public.ai_sources_allowlist (host, purpose) values ('versioned.gov.dz', 'Visa rules')`);
    await exec(`update public.ai_sources_allowlist set purpose = 'Visa rules v2', version = 99 where host = 'versioned.gov.dz'`);
    const after = await db.query<{ version: number; purpose: string }>(`select version, purpose from public.ai_sources_allowlist where host = 'versioned.gov.dz'`);
    expect(after.rows[0]).toEqual({ version: 2, purpose: "Visa rules v2" });
    const stale = await db.query<{ host: string }>(`update public.ai_sources_allowlist set status = 'disabled' where host = 'versioned.gov.dz' and version = 1 returning host`);
    expect(stale.rows).toHaveLength(0);
    const status = await db.query<{ status: string }>(`select status from public.ai_sources_allowlist where host = 'versioned.gov.dz'`);
    expect(status.rows[0]?.status).toBe("active");
  });

  it("rejects unknown categories and jurisdictions", async () => {
    await expect(exec(`insert into public.ai_sources_allowlist (host, purpose, category) values ('bad-cat.dz', 'x', 'blog')`)).rejects.toThrow();
    await expect(exec(`insert into public.ai_sources_allowlist (host, purpose, jurisdiction) values ('bad-jur.dz', 'x', 'us')`)).rejects.toThrow();
  });
});

describe("rollback script", () => {
  it("removes what 0018 added and keeps leads and hosts", async () => {
    await exec(load("docs/migrations/0018_rollback.sql"));
    const tables = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'ai_review_items'`);
    expect(tables.rows[0]?.n).toBe(0);
    const cols = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'ai_leads' and column_name = 'version'`);
    expect(cols.rows[0]?.n).toBe(0);
    const lead = await db.query<{ label: string }>(`select label from public.ai_leads where id = '${LEAD}'`);
    expect(lead.rows[0]?.label).toBe("Renamed");
    const host = await db.query<{ host: string }>(`select host from public.ai_sources_allowlist where host = 'legacy-host.dz'`);
    expect(host.rows).toHaveLength(1);
  });
});
