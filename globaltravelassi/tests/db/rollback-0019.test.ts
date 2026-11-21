import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers";

/**
 * Rollback of migration 0019 on disposable PGlite databases only. Two databases: one with a proof (the rollback must
 * refuse and change nothing), and one with legacy data only (the rollback must archive, verify, restore, and recover).
 */

const load = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";
const SERVICE = "00000000-0000-0000-0000-0000000000c1";
const APP = "00000000-0000-0000-0000-0000000000e1";
const APP2 = "00000000-0000-0000-0000-0000000000e2";
const PROOF = `${CUSTOMER}/${APP}/payment-proof.pdf`;

async function seed(db: PGlite, withProof: boolean) {
  await db.exec(load("supabase/migrations/0019_manual_payments.sql"));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values ('${OWNER}', 'owner@example.dz', '{}'), ('${CUSTOMER}', 'c@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${OWNER}';
    insert into public.services (id, slug, category, title_ar, title_fr, title_en, price, currency)
      values ('${SERVICE}', 'rollback-fixture', 'visa', 'تأشيرة', 'Visa', 'Visa', 15000, 'DZD');
    insert into public.applications (id, user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, status)
      values ('${APP}', '${CUSTOMER}', '${SERVICE}', 'Client', 'c@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved'),
             ('${APP2}', '${CUSTOMER}', '${SERVICE}', 'Client', 'c@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'completed');
    insert into public.payments (application_id, amount, currency, method, status, received_at) values
      ('${APP2}', 15000, 'DZD', 'cash', 'received', now()),
      ('${APP2}', 500, 'DZD', 'bank_transfer', 'cancelled', null);
  `);
  if (withProof) {
    await db.exec(`
      insert into storage.objects (bucket_id, name) values ('customer-documents', '${PROOF}');
      insert into public.payments (application_id, amount, currency, method, status, evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
        values ('${APP}', 15000, 'DZD', 'usdt', 'pending_review', '${PROOF}', 'application/pdf', 1000, now(), '${CUSTOMER}');
    `);
  }
}

const count = async (db: PGlite, table: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n);
const tableExists = async (db: PGlite, name: string) => (await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = '${name}'`)).rows[0]!.n === 1;
const columnExists = async (db: PGlite, name: string) => (await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'payments' and column_name = '${name}'`)).rows[0]!.n === 1;

describe("rollback refuses while proofs exist, and changes nothing", () => {
  it("refuses without the confirmation, and refuses with a proof present; the database is unchanged", async () => {
    const db = await createTestDb();
    try {
      await seed(db, true);
      const before = { payments: await count(db, "public.payments"), audit: await count(db, "public.payment_audit"), proofCol: await columnExists(db, "evidence_path") };

      await expect(db.exec(load("docs/migrations/0019_rollback.sql"))).rejects.toThrow(/set gta.rollback_confirmed/);
      await db.exec("rollback");

      await db.exec(`set gta.rollback_confirmed = 'yes'`);
      await expect(db.exec(load("docs/migrations/0019_rollback.sql"))).rejects.toThrow(/Rollback refused: 1 payment proofs/);
      await db.exec("rollback");
      await db.exec(`reset gta.rollback_confirmed`);

      expect(await count(db, "public.payments")).toBe(before.payments);
      expect(await count(db, "public.payment_audit")).toBe(before.audit);
      expect(await columnExists(db, "evidence_path")).toBe(before.proofCol);
      expect(await tableExists(db, "payments_archive_0019")).toBe(false);
      expect(await tableExists(db, "payment_audit_archive_0019")).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("refuses while a payment is awaiting review, even without a file", async () => {
    const db = await createTestDb();
    try {
      await seed(db, true);
      await db.exec(`update public.payments set status = 'rejected', verified_by = '${OWNER}', verified_at = now(), customer_visible_rejection_message = 'Wrong amount' where evidence_path = '${PROOF}'`).catch(() => undefined);
      await db.exec(`set gta.rollback_confirmed = 'yes'`);
      await expect(db.exec(load("docs/migrations/0019_rollback.sql"))).rejects.toThrow(/Rollback refused/);
      await db.exec("rollback");
    } finally {
      await db.close();
    }
  });
});

describe("rollback archives, verifies, restores and recovers on legacy data", () => {
  it("archives every 0019 table, restores the 0001 rules, keeps every record, and can be re-applied", async () => {
    const db = await createTestDb();
    try {
      await seed(db, false);
      const payments = await count(db, "public.payments");
      const paymentIds = (await db.query<{ id: string }>(`select id from public.payments order by id`)).rows.map((r) => r.id);
      const historyBefore = await count(db, "public.payment_method_history");

      await db.exec(`set gta.rollback_confirmed = 'yes'`);
      await db.exec(load("docs/migrations/0019_rollback.sql"));
      await db.exec(`reset gta.rollback_confirmed`);

      // Archives hold every row that existed.
      expect(await count(db, "public.payments_archive_0019")).toBe(payments);
      expect(await count(db, "public.payment_method_history_archive_0019")).toBe(historyBefore);
      // Live records are kept, row for row.
      expect((await db.query<{ id: string }>(`select id from public.payments order by id`)).rows.map((r) => r.id)).toEqual(paymentIds);
      expect((await db.query<{ status: string }>(`select status from public.applications where id = '${APP2}'`)).rows[0]?.status).toBe("completed");
      // The 0019 columns, tables and views are gone; the 0001 rules are back.
      expect(await columnExists(db, "evidence_path")).toBe(false);
      expect(await tableExists(db, "payment_audit")).toBe(false);
      expect(await tableExists(db, "payment_method_settings")).toBe(false);
      const views = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.views where table_name in ('customer_payments', 'customer_application_events')`);
      expect(views.rows[0]?.n).toBe(0);
      const readPolicy = await db.query<{ qual: string }>(`select qual from pg_policies where tablename = 'payments' and policyname = 'payments_read'`);
      expect(readPolicy.rows[0]?.qual).toContain("applications");
      const status = await db.query<{ n: number }>(`select count(*)::int as n from pg_constraint where conname = 'applications_status_check' and pg_get_constraintdef(oid) not like '%payment_pending%'`);
      expect(status.rows[0]?.n).toBe(1);

      // Recovery: 0019 is applied again on top of the rolled-back schema, and the records are still there.
      await db.exec(load("supabase/migrations/0019_manual_payments.sql"));
      expect(await count(db, "public.payments")).toBe(payments);
      expect(await count(db, "public.payments_archive_0019")).toBe(payments);

      // A second rollback is refused while the first archive exists: nothing is overwritten.
      await db.exec(`set gta.rollback_confirmed = 'yes'`);
      await expect(db.exec(load("docs/migrations/0019_rollback.sql"))).rejects.toThrow(/archive from an earlier rollback exists/);
      await db.exec("rollback");
    } finally {
      await db.close();
    }
  });
});
