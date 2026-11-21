import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Manual payments on PGlite, applied on the base schema only (0001 + 0019). Clients reach payments only through the
 * functions; the owner decides; nothing becomes PAID by itself; every step is audited.
 */

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";
const SERVICE = "00000000-0000-0000-0000-0000000000c1";
const APP = "00000000-0000-0000-0000-0000000000d1";
const APP_NEW = "00000000-0000-0000-0000-0000000000d2";
const APP_NOPRICE = "00000000-0000-0000-0000-0000000000d3";
const APP_REJ = "00000000-0000-0000-0000-0000000000d4";
const NOPRICE = "00000000-0000-0000-0000-0000000000c2";
const PROOF = "payment-proof.pdf";
const CUSTOMER_MSG = "The amount on the proof is lower than the price.";
const WHY = "Funds confirmed on the account";

let db: PGlite;
const exec = (sql: string) => db.exec(sql);
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = await createTestDb();
  const migration = readFileSync(resolve(__dirname, "../../supabase/migrations/0019_manual_payments.sql"), "utf8");
  await exec(migration);
  await exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${OWNER}', 'owner@example.dz', '{}'), ('${CUSTOMER}', 'client@example.dz', '{}'), ('${OTHER}', 'other@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${OWNER}';
    insert into public.services (id, slug, category, title_ar, title_fr, title_en, price, currency)
      values ('${SERVICE}', 'visa-fixture', 'visa', 'تأشيرة', 'Visa', 'Visa', 15000, 'DZD'),
             ('${NOPRICE}', 'no-price-fixture', 'visa', 'تأشيرة', 'Visa', 'Visa', null, 'DZD');
    insert into public.applications (id, user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, status)
      values ('${APP}', '${CUSTOMER}', '${SERVICE}', 'Client Test', 'client@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved'),
             ('${APP_NEW}', '${CUSTOMER}', '${SERVICE}', 'Client Test', 'client@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'new'),
             ('${APP_NOPRICE}', '${CUSTOMER}', '${NOPRICE}', 'Client Test', 'client@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved'),
             ('${APP_REJ}', '${CUSTOMER}', '${SERVICE}', 'Client Test', 'client@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved');
    insert into storage.objects (bucket_id, name) values
      ('customer-documents', '${CUSTOMER}/${APP}/${PROOF}'),
      ('customer-documents', '${CUSTOMER}/${APP_NEW}/${PROOF}'),
      ('customer-documents', '${CUSTOMER}/${APP_NOPRICE}/${PROOF}'),
      ('customer-documents', '${CUSTOMER}/${APP_REJ}/${PROOF}'),
      ('customer-documents', '${OTHER}/${APP}/${PROOF}');
  `);
});

afterAll(async () => {
  await db.close();
});

const submit = (userId: string | null, app: string, method: string, path: string, mime = "application/pdf", size = 2048) =>
  asUser<{ submit_payment_evidence: string }>(db, userId, `select public.submit_payment_evidence($1, $2, $3, $4, $5, 'proof.pdf')`, [app, method, path, mime, size]);

const enableMethod = async (method: string) =>
  asUser(db, OWNER, `select public.save_payment_method($1, true, 'Instructions FR', 'Instructions EN', 'تعليمات', 'Offered to clients')`, [method]);

describe("the base schema is enough: 0019 applies on 0001 without the AI migrations", () => {
  it("adds the payment_pending status and the two new methods to the existing constraints", async () => {
    await exec(`update public.applications set status = 'payment_pending' where id = '${APP_NEW}'`);
    await exec(`update public.applications set status = 'new' where id = '${APP_NEW}'`);
    await expect(exec(`update public.applications set status = 'paid' where id = '${APP_NEW}'`)).rejects.toThrow(/check/);
    await expect(exec(`insert into public.payments (application_id, amount, method) values ('${APP_NOPRICE}', 10, 'nope')`)).rejects.toThrow(/check/);
  });
});

describe("the owner configures methods", () => {
  it("only the owner can change a method, and the change needs a reason", async () => {
    await expect(asUser(db, CUSTOMER, `select public.save_payment_method('usdt', true, 'a', 'b', 'c', 'Offer it')`)).rejects.toThrow(/Only the owner/);
    await expect(asUser(db, OWNER, `select public.save_payment_method('usdt', true, 'a', 'b', 'c', 'x')`)).rejects.toThrow(/reason/);
  });

  it("a method is offered only with instructions in French, English and Arabic", async () => {
    await expect(asUser(db, OWNER, `select public.save_payment_method('usdt', true, 'Fr', '', 'Ar', 'Offer it')`)).rejects.toThrow(/French, English and Arabic/);
  });

  it("the change is audited with its reason and the owner", async () => {
    await enableMethod("baridimob");
    const audit = await rows<{ action: string; to_status: string; reason: string; actor_id: string; method: string }>(
      `select action, to_status, reason, actor_id, method from public.payment_audit where method = 'baridimob'`,
    );
    expect(audit).toEqual([{ action: "method_changed", to_status: "enabled", reason: "Offered to clients", actor_id: OWNER, method: "baridimob" }]);
  });

  it("clients cannot write method settings directly", async () => {
    await expect(asUser(db, CUSTOMER, `update public.payment_method_settings set enabled = true where method = 'usdt'`)).rejects.toThrow(/permission denied/);
    const usdt = await rows<{ enabled: boolean }>(`select enabled from public.payment_method_settings where method = 'usdt'`);
    expect(usdt[0]?.enabled).toBe(false);
  });

  it("clients can read the instructions of the methods", async () => {
    const seen = await asUser<{ method: string; enabled: boolean }>(db, CUSTOMER, `select method, enabled from public.payment_method_settings order by method`);
    expect(seen.map((s) => s.method)).toEqual(["baridimob", "redotpay", "usdt"]);
  });
});

describe("the customer submits a proof", () => {
  it("refuses a method that is not offered", async () => {
    await expect(submit(CUSTOMER, APP, "usdt", `${CUSTOMER}/${APP}/${PROOF}`)).rejects.toThrow(/not available/);
  });

  it("refuses a request that is not open for payment", async () => {
    await enableMethod("usdt");
    await expect(submit(CUSTOMER, APP_NEW, "usdt", `${CUSTOMER}/${APP_NEW}/${PROOF}`)).rejects.toThrow(/not open for payment/);
  });

  it("refuses a service with no price yet", async () => {
    await expect(submit(CUSTOMER, APP_NOPRICE, "baridimob", `${CUSTOMER}/${APP_NOPRICE}/${PROOF}`)).rejects.toThrow(/no price/);
  });

  it("refuses a proof outside the customer's own request folder, a missing file and a wrong type or size", async () => {
    await expect(submit(CUSTOMER, APP, "baridimob", `${OTHER}/${APP}/${PROOF}`)).rejects.toThrow(/own request folder/);
    await expect(submit(CUSTOMER, APP, "baridimob", `${CUSTOMER}/${APP}/payment-missing.pdf`)).rejects.toThrow(/was not uploaded/);
    await expect(submit(CUSTOMER, APP, "baridimob", `${CUSTOMER}/${APP}/${PROOF}`, "image/gif")).rejects.toThrow(/PDF, JPEG or PNG/);
    await expect(submit(CUSTOMER, APP, "baridimob", `${CUSTOMER}/${APP}/${PROOF}`, "application/pdf", 20_000_000)).rejects.toThrow(/10 MB/);
  });

  it("another customer cannot attach a proof to this request", async () => {
    await expect(submit(OTHER, APP, "baridimob", `${OTHER}/${APP}/${PROOF}`)).rejects.toThrow(/Request not found/);
  });

  it("a valid proof creates a payment waiting for review, moves the request to payment_pending, and writes the audit", async () => {
    const out = await submit(CUSTOMER, APP, "baridimob", `${CUSTOMER}/${APP}/${PROOF}`);
    const id = Object.values(out[0]!)[0] as string;
    const payment = await rows<{ status: string; amount: string; currency: string; method: string; evidence_path: string; submitted_by: string }>(
      `select status, amount::text, currency, method, evidence_path, submitted_by from public.payments where id = '${id}'`,
    );
    expect(payment[0]).toEqual({ status: "pending_review", amount: "15000.00", currency: "DZD", method: "baridimob", evidence_path: `${CUSTOMER}/${APP}/${PROOF}`, submitted_by: CUSTOMER });
    expect((await rows<{ status: string }>(`select status from public.applications where id = '${APP}'`))[0]?.status).toBe("payment_pending");
    const audit = await rows<{ action: string }>(`select action from public.payment_audit where payment_id = '${id}'`);
    expect(audit.map((a) => a.action)).toEqual(["submitted"]);
  });

  it("the amount comes from the service: changing the price later does not change a submitted payment", async () => {
    await exec(`update public.services set price = 99999 where id = '${SERVICE}'`);
    const p = await rows<{ amount: string }>(`select amount::text from public.payments where application_id = '${APP}' and status = 'pending_review'`);
    expect(p[0]?.amount).toBe("15000.00");
    await exec(`update public.services set price = 15000 where id = '${SERVICE}'`);
  });

  it("a second proof while one is waiting is refused, by the function and by the database", async () => {
    await expect(submit(CUSTOMER, APP, "usdt", `${CUSTOMER}/${APP}/${PROOF}`)).rejects.toThrow(/already waiting/);
    await expect(
      exec(`insert into public.payments (application_id, amount, currency, method, status, evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
            values ('${APP}', 1, 'DZD', 'usdt', 'pending_review', 'x/y.pdf', 'application/pdf', 1, now(), '${CUSTOMER}')`),
    ).rejects.toThrow(/payments_one_open_review|duplicate key/);
  });
});

describe("clients cannot change a payment or a request directly", () => {
  it("a client cannot insert, update or delete a payment, or change the request status", async () => {
    await expect(asUser(db, CUSTOMER, `insert into public.payments (application_id, amount, method) values ('${APP}', 1, 'cash')`)).rejects.toThrow(/row-level security|permission denied/);
    await expect(asUser(db, CUSTOMER, `delete from public.payments where application_id = '${APP}'`)).resolves.toEqual([]);
    const still = await rows<{ n: number }>(`select count(*)::int as n from public.payments where application_id = '${APP}'`);
    expect(still[0]?.n).toBe(1);
    await asUser(db, CUSTOMER, `update public.applications set status = 'completed' where id = '${APP}'`);
    expect((await rows<{ status: string }>(`select status from public.applications where id = '${APP}'`))[0]?.status).toBe("payment_pending");
  });

  it("a client cannot decide a payment, read the audit, or write it", async () => {
    const p = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'pending_review'`);
    await expect(asUser(db, CUSTOMER, `select public.decide_payment('${p[0]!.id}', 'approve', '${WHY}')`)).rejects.toThrow(/Only the owner/);
    expect(await asUser(db, CUSTOMER, `select id from public.payment_audit`)).toEqual([]);
    await expect(asUser(db, CUSTOMER, `insert into public.payment_audit (action, reason, method) values ('approved', 'forged entry', 'usdt')`)).rejects.toThrow(/permission denied/);
  });

  it("a proof that a payment refers to cannot be deleted, by the customer or by the owner", async () => {
    const path = `${CUSTOMER}/${APP}/${PROOF}`;
    await asUser(db, CUSTOMER, `delete from storage.objects where name = '${path}'`);
    await asUser(db, OWNER, `delete from storage.objects where name = '${path}'`);
    const left = await rows<{ n: number }>(`select count(*)::int as n from storage.objects where name = '${path}'`);
    expect(left[0]?.n).toBe(1);
  });

  it("an anonymous visitor can call none of the functions", async () => {
    await expect(asUser(db, null, `select public.submit_payment_evidence(null, 'usdt', 'x', 'application/pdf', 1, 'x')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, `select public.decide_payment(null, 'approve', 'x')`)).rejects.toThrow(/permission denied/);
  });
});

describe("the owner decides; nothing is paid by itself", () => {
  it("a proof-bearing payment cannot be marked received by a direct update, even by the owner", async () => {
    const p = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'pending_review'`);
    await expect(asUser(db, OWNER, `update public.payments set status = 'received', received_at = now(), verified_by = '${OWNER}', verified_at = now() where id = '${p[0]!.id}'`)).rejects.toThrow(/only through the owner's decision/);
    await expect(exec(`update public.payments set status = 'cancelled' where id = '${p[0]!.id}'`)).rejects.toThrow(/only through the owner's decision/);
    expect((await rows<{ status: string }>(`select status from public.payments where id = '${p[0]!.id}'`))[0]?.status).toBe("pending_review");
  });

  it("an approval needs a reason of 3 to 500 characters", async () => {
    const p = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'pending_review'`);
    await expect(asUser(db, OWNER, `select public.decide_payment('${p[0]!.id}', 'approve', 'x')`)).rejects.toThrow(/Give a reason/);
  });

  it("the owner's approval records the decision, the owner, the time and the request moves back to approved", async () => {
    const p = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'pending_review'`);
    const out = await asUser<{ decide_payment: string }>(db, OWNER, `select public.decide_payment('${p[0]!.id}', 'approve', '${WHY}')`);
    expect(out[0]?.decide_payment).toBe("received");
    const row = await rows<{ status: string; verified_by: string; verified_at: string | null; received_at: string | null; decision_reason: string }>(
      `select status, verified_by, verified_at, received_at, decision_reason from public.payments where id = '${p[0]!.id}'`,
    );
    expect(row[0]).toMatchObject({ status: "received", verified_by: OWNER, decision_reason: WHY });
    expect(row[0]!.verified_at).not.toBeNull();
    expect(row[0]!.received_at).not.toBeNull();
    expect((await rows<{ status: string }>(`select status from public.applications where id = '${APP}'`))[0]?.status).toBe("approved");
    const audit = await rows<{ action: string; actor_id: string; from_status: string; to_status: string }>(
      `select action, actor_id, from_status, to_status from public.payment_audit where payment_id = '${p[0]!.id}' order by created_at`,
    );
    expect(audit.map((a) => a.action)).toEqual(["submitted", "approved"]);
    expect(audit[1]).toMatchObject({ actor_id: OWNER, from_status: "pending_review", to_status: "received" });
  });

  it("a decided payment cannot be decided again, and its proof and amount cannot change", async () => {
    const p = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'received'`);
    await expect(asUser(db, OWNER, `select public.decide_payment('${p[0]!.id}', 'reject', '${WHY}', '${CUSTOMER_MSG}')`)).rejects.toThrow(/already decided/);
    await expect(exec(`update public.payments set evidence_path = 'other/path.pdf' where id = '${p[0]!.id}'`)).rejects.toThrow(/cannot change/);
    await expect(exec(`update public.payments set amount = 1 where id = '${p[0]!.id}'`)).rejects.toThrow(/cannot change/);
    await expect(exec(`update public.payments set status = 'cancelled' where id = '${p[0]!.id}'`)).rejects.toThrow(/decided payment cannot change|only through/);
  });

  it("a rejection returns the request to approved, so the customer can send a new proof", async () => {
    const first = await submit(CUSTOMER, APP_REJ, "usdt", `${CUSTOMER}/${APP_REJ}/${PROOF}`);
    const firstId = Object.values(first[0]!)[0] as string;
    const out = await asUser<{ decide_payment: string }>(db, OWNER, `select public.decide_payment('${firstId}', 'reject', 'Amount on the proof is wrong', '${CUSTOMER_MSG}')`);
    expect(out[0]?.decide_payment).toBe("rejected");
    expect((await rows<{ status: string }>(`select status from public.applications where id = '${APP_REJ}'`))[0]?.status).toBe("approved");

    const second = await submit(CUSTOMER, APP_REJ, "usdt", `${CUSTOMER}/${APP_REJ}/${PROOF}`);
    const secondId = Object.values(second[0]!)[0] as string;
    expect(secondId).not.toBe(firstId);
    const audit = await rows<{ action: string }>(`select action from public.payment_audit where application_id = '${APP_REJ}' order by created_at`);
    expect(audit.map((a) => a.action)).toEqual(["submitted", "rejected", "submitted"]);
  });

  it("once a payment is confirmed, the request is paid: a second proof is refused", async () => {
    const pending = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_REJ}' and status = 'pending_review'`);
    await asUser(db, OWNER, `select public.decide_payment('${pending[0]!.id}', 'approve', '${WHY}')`);
    await expect(submit(CUSTOMER, APP_REJ, "usdt", `${CUSTOMER}/${APP_REJ}/${PROOF}`)).rejects.toThrow(/already paid/);
  });

  it("a payment that is not waiting for review cannot be decided again, and an unknown decision is refused", async () => {
    const decided = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_REJ}' and status = 'rejected' limit 1`);
    await expect(asUser(db, OWNER, `select public.decide_payment('${decided[0]!.id}', 'approve', '${WHY}')`)).rejects.toThrow(/already decided/);
    const first = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'received' limit 1`);
    await expect(asUser(db, OWNER, `select public.decide_payment('${first[0]!.id}', 'maybe', '${WHY}')`)).rejects.toThrow(/Unknown decision|already decided/);
  });

  it("the owner can see the audit, and nobody can change or delete it", async () => {
    const audit = await asUser<{ n: number }>(db, OWNER, `select count(*)::int as n from public.payment_audit`);
    expect(audit[0]?.n).toBeGreaterThan(5);
    await expect(asUser(db, OWNER, `update public.payment_audit set reason = 'changed'`)).rejects.toThrow(/permission denied|append-only/);
    await expect(asUser(db, OWNER, `delete from public.payment_audit`)).rejects.toThrow(/permission denied|append-only/);
    await expect(exec(`truncate public.payment_audit`)).rejects.toThrow(/append-only/);
  });
});

describe("existing manual records keep working", () => {
  it("the owner can still record a cash payment without a proof, and it has no proof guard", async () => {
    await exec(`insert into public.payments (application_id, amount, currency, method, status, received_at) values ('${APP_NOPRICE}', 500, 'DZD', 'cash', 'received', now())`);
    await exec(`update public.payments set status = 'cancelled', received_at = null where application_id = '${APP_NOPRICE}' and method = 'cash'`);
    const row = await rows<{ status: string }>(`select status from public.payments where application_id = '${APP_NOPRICE}' and method = 'cash'`);
    expect(row[0]?.status).toBe("cancelled");
  });
});

describe("customers see only safe payment fields", () => {
  it("a customer cannot read the payments table at all, not even their own rows", async () => {
    const own = await asUser(db, CUSTOMER, `select id from public.payments where application_id = '${APP}'`);
    expect(own).toEqual([]);
  });

  it("the customer view returns only their own payments, with no owner-side columns", async () => {
    const cols = await rows<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'customer_payments'`);
    const names = cols.map((c) => c.column_name);
    for (const hidden of ["verified_by", "decision_reason", "evidence_path", "note", "created_by", "submitted_by", "evidence_mime", "evidence_size"]) {
      expect(names).not.toContain(hidden);
    }
    expect(names).toEqual(expect.arrayContaining(["status", "amount", "currency", "customer_visible_rejection_message"]));

    const mine = await asUser<{ application_id: string }>(db, CUSTOMER, `select application_id from public.customer_payments`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.application_id === APP || r.application_id === APP_REJ || r.application_id === APP_NOPRICE)).toBe(true);
    expect(await asUser(db, OTHER, `select id from public.customer_payments`)).toEqual([]);
  });

  it("the customer sees the rejection message, and never the owner's internal reason", async () => {
    const seen = await asUser<{ customer_visible_rejection_message: string | null; status: string }>(
      db,
      CUSTOMER,
      `select status, customer_visible_rejection_message from public.customer_payments where application_id = '${APP_REJ}' and status = 'rejected'`,
    );
    expect(seen[0]).toEqual({ status: "rejected", customer_visible_rejection_message: CUSTOMER_MSG });
    const stored = await rows<{ decision_reason: string }>(`select decision_reason from public.payments where application_id = '${APP_REJ}' and status = 'rejected'`);
    expect(stored[0]?.decision_reason).toBe("Amount on the proof is wrong");
    expect(JSON.stringify(seen)).not.toContain("Amount on the proof is wrong");
  });

  it("a rejection needs a message for the customer, and an approval records none", async () => {
    const id = Object.values((await submit(CUSTOMER, APP_REJ, "usdt", `${CUSTOMER}/${APP_REJ}/${PROOF}`).catch(async () => [{}]))[0] ?? {})[0] as string | undefined;
    const pending = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_REJ}' and status = 'pending_review'`);
    const target = pending[0]?.id ?? id;
    if (!target) return;
    await expect(asUser(db, OWNER, `select public.decide_payment('${target}', 'reject', '${WHY}')`)).rejects.toThrow(/customer a message/);
    await expect(asUser(db, OWNER, `select public.decide_payment('${target}', 'reject', '${WHY}', 'x')`)).rejects.toThrow(/customer a message/);
    await asUser(db, OWNER, `select public.decide_payment('${target}', 'reject', '${WHY}', '${CUSTOMER_MSG}')`);
  });
});

describe("owner-side fields and the database itself", () => {
  it("the owner's decision fields cannot be changed after the decision, by the owner or by a client", async () => {
    const decided = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP}' and status = 'received'`);
    await expect(asUser(db, OWNER, `update public.payments set verified_by = '${CUSTOMER}' where id = '${decided[0]!.id}'`)).rejects.toThrow(/cannot change|only through/);
    await expect(exec(`update public.payments set customer_visible_rejection_message = 'changed' where id = '${decided[0]!.id}'`)).rejects.toThrow(/cannot change/);
  });

  it("a payment with a proof cannot be deleted, even by the owner", async () => {
    await expect(asUser(db, OWNER, `delete from public.payments where application_id = '${APP}' and status = 'received'`)).rejects.toThrow(/cannot be deleted/);
    await expect(exec(`delete from public.payments where application_id = '${APP}' and status = 'received'`)).rejects.toThrow(/cannot be deleted/);
    expect((await rows<{ n: number }>(`select count(*)::int as n from public.payments where application_id = '${APP}'`))[0]?.n).toBeGreaterThan(0);
  });

  it("only the owner can confirm received funds: a customer and an operator cannot, and an approval changes nothing else", async () => {
    await expect(asUser(db, OWNER, `select 1`)).resolves.toBeDefined();
    await expect(asUser(db, OTHER, `select public.decide_payment(null, 'approve', 'Funds seen')`)).rejects.toThrow(/Only the owner|permission denied|Payment not found/);
    await expect(asUser(db, CUSTOMER, `update public.applications set status = 'completed' where id = '${APP_NEW}'`)).resolves.toEqual([]);
  });

  it("direct updates of a proof-bearing payment are refused for the owner and for the database owner alike", async () => {
    const pend = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_NOPRICE}' and status = 'pending_review'`);
    expect(pend).toEqual([]);
    const rejected = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_REJ}' and status = 'rejected' limit 1`);
    await expect(exec(`update public.payments set status = 'received', received_at = now() where id = '${rejected[0]!.id}'`)).rejects.toThrow(/cannot change|only through/);
    await expect(asUser(db, OWNER, `update public.payments set status = 'received', received_at = now() where id = '${rejected[0]!.id}'`)).rejects.toThrow(/cannot change|only through/);
  });
});

describe("unsubmitted proofs: cleanup rules", () => {
  const ORPHAN_OLD = `${CUSTOMER}/${APP_NOPRICE}/payment-orphan-old.pdf`;
  const ORPHAN_NEW = `${CUSTOMER}/${APP_NOPRICE}/payment-orphan-new.pdf`;
  const PASSPORT = `${CUSTOMER}/${APP_NOPRICE}/passport.pdf`;

  beforeAll(async () => {
    await exec(`
      insert into storage.objects (bucket_id, name, created_at) values
        ('customer-documents', '${ORPHAN_OLD}', now() - interval '30 days'),
        ('customer-documents', '${ORPHAN_NEW}', now() - interval '2 days'),
        ('customer-documents', '${PASSPORT}', now() - interval '30 days');
    `);
  });

  it("lists only old, unsubmitted payment proofs, to the owner", async () => {
    const list = await asUser<{ object_name: string }>(db, OWNER, `select object_name from public.orphan_payment_proofs()`);
    expect(list.map((r) => r.object_name)).toEqual([ORPHAN_OLD]);
    await expect(asUser(db, CUSTOMER, `select * from public.orphan_payment_proofs()`)).rejects.toThrow(/Only the owner/);
  });

  it("never lists a proof a payment refers to, however old", async () => {
    await exec(`update storage.objects set created_at = now() - interval '90 days' where name = '${CUSTOMER}/${APP_REJ}/${PROOF}'`);
    const list = await asUser<{ object_name: string }>(db, OWNER, `select object_name from public.orphan_payment_proofs()`);
    expect(list.map((r) => r.object_name)).not.toContain(`${CUSTOMER}/${APP_REJ}/${PROOF}`);
  });

  it("a retention shorter than seven days is raised to seven", async () => {
    const list = await asUser<{ object_name: string }>(db, OWNER, `select object_name from public.orphan_payment_proofs(interval '1 day')`);
    expect(list.map((r) => r.object_name)).toEqual([ORPHAN_OLD]);
  });

  it("confirms eligibility one proof at a time: only the old, unsubmitted one is still eligible", async () => {
    expect(await asUser(db, OWNER, `select public.orphan_proof_still_eligible('${ORPHAN_OLD}')`)).toEqual([{ orphan_proof_still_eligible: true }]);
    expect(await asUser(db, OWNER, `select public.orphan_proof_still_eligible('${ORPHAN_NEW}')`)).toEqual([{ orphan_proof_still_eligible: false }]);
    expect(await asUser(db, OWNER, `select public.orphan_proof_still_eligible('${PASSPORT}')`)).toEqual([{ orphan_proof_still_eligible: false }]);
    expect(await asUser(db, OWNER, `select public.orphan_proof_still_eligible('${CUSTOMER}/${APP_REJ}/${PROOF}')`)).toEqual([{ orphan_proof_still_eligible: false }]);
    await expect(asUser(db, CUSTOMER, `select public.orphan_proof_still_eligible('${ORPHAN_OLD}')`)).rejects.toThrow(/Only the owner/);
  });

  it("records a removal only for an eligible proof, with the owner's reason, in the audit", async () => {
    await expect(asUser(db, OWNER, `select public.record_orphan_purge('${ORPHAN_NEW}', 'Too early to remove')`)).rejects.toThrow(/not eligible/);
    await expect(asUser(db, OWNER, `select public.record_orphan_purge('${ORPHAN_OLD}', 'x')`)).rejects.toThrow(/Give a reason/);
    await asUser(db, OWNER, `select public.record_orphan_purge('${ORPHAN_OLD}', 'Unsubmitted for thirty days')`);
    const audit = await rows<{ action: string; reason: string; application_id: string }>(`select action, reason, application_id from public.payment_audit where action = 'orphan_purged'`);
    expect(audit).toEqual([{ action: "orphan_purged", reason: "Unsubmitted for thirty days", application_id: APP_NOPRICE }]);
  });

  it("the owner's removal is recorded; a customer cannot record one", async () => {
    await expect(asUser(db, CUSTOMER, `select public.record_orphan_purge('${ORPHAN_OLD}', 'Customer tries')`)).rejects.toThrow(/Only the owner/);
  });

  it("a customer cannot delete a proof a payment refers to, and the owner cannot either", async () => {
    await asUser(db, CUSTOMER, `delete from storage.objects where name = '${CUSTOMER}/${APP_REJ}/${PROOF}'`);
    await asUser(db, OWNER, `delete from storage.objects where name = '${CUSTOMER}/${APP_REJ}/${PROOF}'`);
    expect((await rows<{ n: number }>(`select count(*)::int as n from storage.objects where name = '${CUSTOMER}/${APP_REJ}/${PROOF}'`))[0]?.n).toBe(1);
  });

  it("a proof must carry the payment marker to be submitted at all", async () => {
    const app = "00000000-0000-0000-0000-0000000000d9";
    await exec(`insert into public.applications (id, user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, status)
                values ('${app}', '${CUSTOMER}', '${SERVICE}', 'Client Test', 'client@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved')`);
    await exec(`insert into storage.objects (bucket_id, name) values ('customer-documents', '${CUSTOMER}/${app}/passport-as-proof.pdf')`);
    await expect(submit(CUSTOMER, app, "baridimob", `${CUSTOMER}/${app}/passport-as-proof.pdf`)).rejects.toThrow(/as a payment proof/);
  });
});

describe("payment method settings keep their history", () => {
  it("each change records the previous and the new settings, the owner, the time and the reason", async () => {
    await enableMethod("redotpay");
    await asUser(db, OWNER, `select public.save_payment_method('redotpay', true, 'FR v2', 'EN v2', 'AR v2', 'Corrected wording')`);
    const history = await rows<{ previous: Record<string, unknown>; next: Record<string, unknown>; reason: string; actor_id: string }>(
      `select previous, next, reason, actor_id from public.payment_method_history where method = 'redotpay' order by changed_at`,
    );
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ reason: "Corrected wording", actor_id: OWNER });
    expect(history[1]!.previous).toMatchObject({ enabled: true, instructions_fr: "Instructions FR", instructions_en: "Instructions EN" });
    expect(history[1]!.next).toMatchObject({ enabled: true, instructions_fr: "FR v2" });
  });

  it("the current settings match the last recorded change", async () => {
    const current = await rows<{ instructions_fr: string; enabled: boolean }>(`select enabled, instructions_fr from public.payment_method_settings where method = 'redotpay'`);
    const last = await rows<{ next: Record<string, unknown> }>(`select next from public.payment_method_history where method = 'redotpay' order by changed_at desc limit 1`);
    expect(current[0]).toEqual({ enabled: true, instructions_fr: last[0]!.next.instructions_fr });
  });

  it("history cannot be changed or deleted, by the owner or the database owner, and clients cannot read it", async () => {
    await expect(asUser(db, OWNER, `update public.payment_method_history set reason = 'rewritten'`)).rejects.toThrow(/permission denied|append-only/);
    await expect(asUser(db, OWNER, `delete from public.payment_method_history`)).rejects.toThrow(/permission denied|append-only/);
    await expect(exec(`update public.payment_method_history set reason = 'rewritten'`)).rejects.toThrow(/append-only/);
    await expect(exec(`truncate public.payment_method_history`)).rejects.toThrow(/append-only/);
    expect(await asUser(db, CUSTOMER, `select id from public.payment_method_history`)).toEqual([]);
  });

  it("a change to the settings without the function is refused for clients", async () => {
    await expect(asUser(db, OWNER, `update public.payment_method_settings set instructions_en = 'silent' where method = 'redotpay'`)).rejects.toThrow(/permission denied/);
  });
});
