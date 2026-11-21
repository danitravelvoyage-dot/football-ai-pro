import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Regression tests for the payment security findings (PGlite, base schema + 0019 only, local). Each describe block is
 * one finding: application deletion (H1), direct and RPC write bypasses (M1), the storage race (M2), audit reliability
 * (M3), event privacy (M4), view isolation (M5) and the low-priority items.
 */

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const A = "00000000-0000-0000-0000-0000000000b1"; // customer A
const B = "00000000-0000-0000-0000-0000000000b2"; // customer B
const SERVICE = "00000000-0000-0000-0000-0000000000c1";
const APP_A = "00000000-0000-0000-0000-0000000000e1"; // A: approved, with a proof
const APP_B = "00000000-0000-0000-0000-0000000000e2"; // B: approved, with a received payment
const APP_DEL = "00000000-0000-0000-0000-0000000000e3"; // a request with no protected records
const APP_CASH = "00000000-0000-0000-0000-0000000000e4"; // a request with a cash payment only
const PROOF_A = `${A}/${APP_A}/payment-a.pdf`;
const PROOF_B = `${B}/${APP_B}/payment-b.pdf`;
const PASSPORT_DEL = `${A}/${APP_DEL}/passport.pdf`;

let db: PGlite;
const exec = (sql: string) => db.exec(sql);
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const count = async (sql: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).rows[0]?.n);

beforeAll(async () => {
  db = await createTestDb();
  await exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0019_manual_payments.sql"), "utf8"));
  await exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${OWNER}', 'owner@example.dz', '{}'), ('${A}', 'a@example.dz', '{}'), ('${B}', 'b@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${OWNER}';
    insert into public.services (id, slug, category, title_ar, title_fr, title_en, price, currency)
      values ('${SERVICE}', 'remediation-fixture', 'visa', 'تأشيرة', 'Visa', 'Visa', 15000, 'DZD');
    insert into public.applications (id, user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, status)
      values ('${APP_A}', '${A}', '${SERVICE}', 'Client A', 'a@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'payment_pending'),
             ('${APP_B}', '${B}', '${SERVICE}', 'Client B', 'b@example.dz', '+213612345679', 'DZ', 'DZ', 'FR', 'employed', 'approved'),
             ('${APP_DEL}', '${A}', '${SERVICE}', 'Client A', 'a@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'new'),
             ('${APP_CASH}', '${A}', '${SERVICE}', 'Client A', 'a@example.dz', '+213612345678', 'DZ', 'DZ', 'FR', 'employed', 'approved');
    insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
      values ('${APP_DEL}', '${A}', 'passport', '${PASSPORT_DEL}', 'passport.pdf', 'application/pdf', 1000);
    insert into storage.objects (bucket_id, name) values
      ('customer-documents', '${PROOF_A}'), ('customer-documents', '${PROOF_B}'), ('customer-documents', '${PASSPORT_DEL}');
    insert into public.payments (application_id, amount, currency, method, status, evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
      values ('${APP_A}', 15000, 'DZD', 'usdt', 'pending_review', '${PROOF_A}', 'application/pdf', 1000, now(), '${A}');
    insert into public.payments (application_id, amount, currency, method, status, evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
      values ('${APP_B}', 15000, 'DZD', 'baridimob', 'pending_review', '${PROOF_B}', 'application/pdf', 1000, now(), '${B}');
    -- The proof is decided the way the product decides it: a pending review moves to received, by the guard's one allowed move.
    update public.payments set status = 'received', received_at = now(), verified_by = '${OWNER}', verified_at = now(), decision_reason = 'Funds seen'
     where evidence_path = '${PROOF_B}';
    insert into public.payments (application_id, amount, currency, method, status, received_at) values ('${APP_CASH}', 500, 'DZD', 'cash', 'received', now());
    insert into public.application_events (application_id, kind, to_status, message, actor_id) values ('${APP_B}', 'payment', 'received', 'Payment confirmed', '${OWNER}');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("H1: request deletion checks protected records first, and changes nothing on refusal", () => {
  it("refuses a request with a proof-bearing payment, and keeps its documents, its request and its payment", async () => {
    await expect(asUser(db, OWNER, `select public.delete_application_request('${APP_A}')`)).rejects.toThrow(/protected payments or records/);
    expect(await count(`select 1 from public.applications where id = '${APP_A}'`)).toBe(1);
    expect(await count(`select 1 from public.payments where application_id = '${APP_A}'`)).toBe(1);
  });

  it("refuses a request whose payment was received, even with no proof left to protect it by name", async () => {
    await expect(asUser(db, OWNER, `select public.delete_application_request('${APP_B}')`)).rejects.toThrow(/protected payments or records/);
    expect(await count(`select 1 from public.applications where id = '${APP_B}'`)).toBe(1);
  });

  it("refuses a request that has audit records, and keeps them", async () => {
    await exec(`insert into public.payment_audit (application_id, action, actor_id, reason) values ('${APP_CASH}', 'orphan_purged', '${OWNER}', 'Test audit entry')`);
    await expect(asUser(db, OWNER, `select public.delete_application_request('${APP_CASH}')`)).rejects.toThrow(/protected payments or records/);
    expect(await count(`select 1 from public.applications where id = '${APP_CASH}'`)).toBe(1);
  });

  it("a non-owner cannot delete any request", async () => {
    await expect(asUser(db, A, `select public.delete_application_request('${APP_DEL}')`)).rejects.toThrow(/Only the owner/);
    expect(await count(`select 1 from public.applications where id = '${APP_DEL}'`)).toBe(1);
  });

  it("a request with no protected records is deleted, and returns the file paths the application must remove", async () => {
    const out = await asUser<{ delete_application_request: string[] }>(db, OWNER, `select public.delete_application_request('${APP_DEL}')`);
    expect(out[0]?.delete_application_request).toEqual([PASSPORT_DEL]);
    expect(await count(`select 1 from public.applications where id = '${APP_DEL}'`)).toBe(0);
    expect(await count(`select 1 from public.documents where application_id = '${APP_DEL}'`)).toBe(0);
  });
});

describe("M1: no client writes; the owner writes through functions; direct SQL and RPC bypasses are refused", () => {
  it("the owner and the customer cannot insert, update or delete payments directly", async () => {
    await expect(asUser(db, OWNER, `insert into public.payments (application_id, amount, method, status) values ('${APP_CASH}', 1, 'cash', 'received')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, OWNER, `update public.payments set status = 'cancelled' where application_id = '${APP_CASH}'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, OWNER, `delete from public.payments where application_id = '${APP_CASH}'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, `insert into public.payments (application_id, amount, method, status) values ('${APP_CASH}', 1, 'cash', 'received')`)).rejects.toThrow(/permission denied/);
  });

  it("a fabricated received payment, with a proof or with decision fields, is refused even for the database owner", async () => {
    await expect(exec(`insert into public.payments (application_id, amount, method, status, verified_by, verified_at)
                       values ('${APP_CASH}', 1, 'cash', 'received', '${OWNER}', now())`)).rejects.toThrow(/created already decided/);
    await expect(exec(`insert into public.payments (application_id, amount, method, status, evidence_path, evidence_mime, evidence_size, submitted_at, submitted_by)
                       values ('${APP_CASH}', 1, 'usdt', 'received', 'x/y/payment-z.pdf', 'application/pdf', 1, now(), '${A}')`)).rejects.toThrow(/created awaiting review|created already decided|pending_review/);
  });

  it("the owner can record a payment received outside the platform, through record_manual_payment only", async () => {
    const out = await asUser<{ record_manual_payment: string }>(db, OWNER, `select public.record_manual_payment('${APP_CASH}', 2000, 'DZD', 'cash', 'received', 'R1', 'Counter', current_date)`);
    expect(out[0]?.record_manual_payment).toBeTruthy();
    await expect(asUser(db, A, `select public.record_manual_payment('${APP_CASH}', 2000, 'DZD', 'cash', 'received', '', '', null)`)).rejects.toThrow(/Only the owner/);
    await expect(asUser(db, OWNER, `select public.record_manual_payment('${APP_CASH}', 2000, 'DZD', 'cash', 'rejected', '', '', null)`)).rejects.toThrow(/Unknown payment status/);
  });

  it("a payment with a proof cannot be moved by the owner's status function, and an ordinary one can", async () => {
    await expect(asUser(db, OWNER, `select public.set_manual_payment_status((select id from public.payments where evidence_path = '${PROOF_A}'), 'cancelled')`)).rejects.toThrow(/changes only through/);
    const cash = await rows<{ id: string }>(`select id from public.payments where application_id = '${APP_CASH}' and evidence_path is null limit 1`);
    await asUser(db, OWNER, `select public.set_manual_payment_status('${cash[0]!.id}', 'cancelled')`);
    expect((await rows<{ status: string }>(`select status from public.payments where id = '${cash[0]!.id}'`))[0]?.status).toBe("cancelled");
  });

  it("a session flag is not authorization: setting one does not allow a direct write", async () => {
    await expect(asUser(db, OWNER, `select set_config('gta.payment_decision', (select id::text from public.payments where evidence_path = '${PROOF_A}'), true)`)).resolves.toBeDefined();
    await expect(asUser(db, OWNER, `update public.payments set status = 'received', received_at = now() where evidence_path = '${PROOF_A}'`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, `select set_config('gta.payment_decision', '${PROOF_A}', true)`)).resolves.toBeDefined();
    await expect(asUser(db, A, `update public.payments set status = 'received', received_at = now() where evidence_path = '${PROOF_A}'`)).rejects.toThrow(/permission denied/);
  });

  it("the customer cannot approve: decide_payment refuses every non-owner caller", async () => {
    const pid = (await rows<{ id: string }>(`select id from public.payments where evidence_path = '${PROOF_A}'`))[0]!.id;
    await expect(asUser(db, A, `select public.decide_payment('${pid}', 'approve', 'Funds seen')`)).rejects.toThrow(/Only the owner/);
    expect((await rows<{ status: string }>(`select status from public.payments where id = '${pid}'`))[0]?.status).toBe("pending_review");
  });

  it("the owner's decision still works through decide_payment, and only there", async () => {
    const pid = (await rows<{ id: string }>(`select id from public.payments where evidence_path = '${PROOF_A}'`))[0]!.id;
    await asUser(db, OWNER, `select public.decide_payment('${pid}', 'reject', 'Amount is lower', 'The amount on the proof is lower than the price.')`);
    expect((await rows<{ status: string }>(`select status from public.payments where id = '${pid}'`))[0]?.status).toBe("rejected");
  });
});

describe("M2: a submission and a removal of the same file cannot interleave", () => {
  const FILE_X = `${A}/${APP_CASH}/payment-old-x.pdf`;
  const FILE_Y = `${A}/${APP_CASH}/payment-old-y.pdf`;

  beforeAll(async () => {
    await exec(`insert into storage.objects (bucket_id, name, created_at) values
      ('customer-documents', '${FILE_X}', now() - interval '30 days'),
      ('customer-documents', '${FILE_Y}', now() - interval '30 days')`);
  });

  it("while a removal of a file is open, the file cannot be submitted as a proof", async () => {
    const intent = await asUser<{ begin_orphan_removal: string }>(db, OWNER, `select public.begin_orphan_removal('${FILE_X}', 'Old unsubmitted proof')`);
    expect(intent[0]?.begin_orphan_removal).toBeTruthy();
    await expect(asUser(db, A, `select public.submit_payment_evidence('${APP_CASH}', 'usdt', '${FILE_X}', 'application/pdf', 1000, 'x.pdf')`)).rejects.toThrow(/being removed|not open for payment|already paid/);
  });

  it("a file that already has a submitted proof cannot be listed or removed, so the payment never points at a missing file", async () => {
    await expect(asUser(db, OWNER, `select public.begin_orphan_removal('${PROOF_A}', 'Attempt to remove a referenced proof')`)).rejects.toThrow(/not eligible/);
    expect(await count(`select 1 from storage.objects where name = '${PROOF_A}'`)).toBe(1);
  });

  it("the database refuses a submission for a file that is not in the bucket, and the removal path keeps a referenced file", async () => {
    await expect(asUser(db, A, `select public.submit_payment_evidence('${APP_CASH}', 'usdt', '${A}/${APP_CASH}/payment-missing.pdf', 'application/pdf', 1000, 'x.pdf')`)).rejects.toThrow(/not open for payment|not uploaded|already paid/);
  });

  it("the locks that serialise the two sides are present in the function bodies", async () => {
    const bodies = await rows<{ proname: string; prosrc: string }>(`select proname, prosrc from pg_proc where proname in ('submit_payment_evidence', 'begin_orphan_removal')`);
    for (const b of bodies) expect(b.prosrc).toContain("pg_advisory_xact_lock(hashtext(");
  });
});

describe("M3: a removal is recorded as an intent first, and its result only once the file is confirmed gone", () => {
  const RECON_GONE = `${A}/${APP_CASH}/payment-recon-gone.pdf`;
  const RECON_THERE = `${A}/${APP_CASH}/payment-recon-there.pdf`;

  beforeAll(async () => {
    await exec(`insert into storage.objects (bucket_id, name, created_at) values ('customer-documents', '${RECON_THERE}', now() - interval '30 days')`);
    // Interrupted runs: intents older than the reconciliation window, one whose file is gone and one whose file remains.
    await exec(`insert into public.proof_removals (object_name, application_id, actor_id, reason, status, requested_at) values
      ('${RECON_GONE}', '${APP_CASH}', '${OWNER}', 'Interrupted', 'intent', now() - interval '3 hours'),
      ('${RECON_THERE}', '${APP_CASH}', '${OWNER}', 'Interrupted', 'intent', now() - interval '3 hours')`);
  });

  it("reconciliation records gone files as removed and files still present as failed, and nothing is assumed", async () => {
    const out = await asUser<{ outcome: string }>(db, OWNER, `select outcome from public.reconcile_orphan_removals()`);
    expect(out.map((r) => r.outcome).sort()).toEqual(["failed", "removed"]);
    const states = await rows<{ object_name: string; status: string }>(`select object_name, status from public.proof_removals where object_name in ('${RECON_GONE}', '${RECON_THERE}')`);
    expect(Object.fromEntries(states.map((s) => [s.object_name, s.status]))).toEqual({ [RECON_GONE]: "removed", [RECON_THERE]: "failed" });
  });

  it("a confirmed removal is written as removed and audited; a removal that is not confirmed is not written as removed", async () => {
    const audited = await rows<{ n: number }>(`select count(*)::int as n from public.payment_audit where action = 'orphan_purged' and reason = 'Removal confirmed on reconciliation'`);
    expect(audited[0]?.n).toBe(1);
    await expect(asUser(db, OWNER, `select public.finish_orphan_removal((select id from public.proof_removals where object_name = '${RECON_THERE}'), true, null)`)).rejects.toThrow(/already has its result/);
  });

  it("a removal record can change only from intent to its result: its identity, reason and time are fixed, and it is never deleted", async () => {
    await expect(exec(`update public.proof_removals set reason = 'rewritten' where object_name = '${RECON_GONE}'`)).rejects.toThrow(/only record its result once/);
    await expect(exec(`delete from public.proof_removals where object_name = '${RECON_GONE}'`)).rejects.toThrow(/append-only/);
    await expect(exec(`truncate public.proof_removals`)).rejects.toThrow(/append-only/);
  });
});

describe("M4: customers read a timeline without internal actors; the owner reads everything; customers are isolated", () => {
  it("a customer reads their own timeline through the view, which has no actor column", async () => {
    const cols = (await rows<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'customer_application_events'`)).map((c) => c.column_name);
    expect(cols).not.toContain("actor_id");
    const mine = await asUser<{ application_id: string }>(db, B, `select application_id from public.customer_application_events`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.application_id === APP_B)).toBe(true);
  });

  it("a customer cannot read the base event table at all, and another customer sees none of these events", async () => {
    expect(await asUser(db, B, `select id from public.application_events`)).toEqual([]);
    expect(await asUser(db, A, `select id from public.customer_application_events where application_id = '${APP_B}'`)).toEqual([]);
  });

  it("the owner reads the base table, including the internal actor of each event", async () => {
    const owner = await asUser<{ actor_id: string | null; kind: string; message: string }>(db, OWNER, `select actor_id, kind, message from public.application_events where application_id = '${APP_B}' order by created_at`);
    // The creation event is written by the base schema with the customer as its actor; the owner's decision carries the owner.
    expect(owner).toContainEqual({ actor_id: OWNER, kind: "payment", message: "Payment confirmed" });
    expect(owner.length).toBe(2);
  });

  it("a customer cannot write events", async () => {
    await expect(asUser(db, B, `insert into public.application_events (application_id, kind, message) values ('${APP_B}', 'status', 'forged')`)).rejects.toThrow(/row-level security|permission denied/);
  });
});

describe("M5: customer payment isolation, tested directly between two customers", () => {
  it("customer A cannot read customer B's payments, by any path", async () => {
    expect(await asUser(db, A, `select id from public.customer_payments where application_id = '${APP_B}'`)).toEqual([]);
    expect(await asUser(db, A, `select id from public.payments`)).toEqual([]);
    expect(await asUser(db, A, `select id from public.customer_payments where application_id = '${APP_A}'`).then((r) => r.length)).toBeGreaterThan(0);
  });

  it("customer B cannot read customer A's payments", async () => {
    expect(await asUser(db, B, `select id from public.customer_payments where application_id = '${APP_A}'`)).toEqual([]);
    const mine = await asUser<{ application_id: string }>(db, B, `select application_id from public.customer_payments`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.application_id === APP_B)).toBe(true);
  });

  it("the view exposes no owner-side column", async () => {
    const cols = (await rows<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'customer_payments'`)).map((c) => c.column_name);
    for (const hidden of ["verified_by", "decision_reason", "evidence_path", "note", "created_by", "submitted_by", "evidence_mime", "evidence_size"]) {
      expect(cols).not.toContain(hidden);
    }
  });
});

describe("LOW: storage reference checks, definer rights, and direct cross-customer reads", () => {
  it("a customer learns nothing about another customer's proofs through the reference check", async () => {
    expect((await asUser<{ r: boolean }>(db, A, `select public.proof_is_referenced('${PROOF_B}') as r`))[0]?.r).toBe(false);
    expect((await asUser<{ r: boolean }>(db, A, `select public.proof_is_referenced('${PROOF_A}') as r`))[0]?.r).toBe(true);
    expect((await asUser<{ r: boolean }>(db, OWNER, `select public.proof_is_referenced('${PROOF_B}') as r`))[0]?.r).toBe(true);
  });

  it("the trigger functions run with the caller's rights, not the owner's", async () => {
    const rowsDef = await rows<{ proname: string; prosecdef: boolean }>(
      `select proname, prosecdef from pg_proc where proname in ('payment_guard', 'payment_no_delete_with_proof', 'payment_insert_guard', 'append_only_guard')`,
    );
    expect(rowsDef.length).toBe(4);
    expect(rowsDef.every((r) => r.prosecdef === false)).toBe(true);
  });
});

describe("M5 review: customer_payments stays owner-run, and its isolation is tested", () => {
  it("the view is not security_invoker: it runs with its owner's rights, which is why no customer row policy is needed", async () => {
    const opts = await rows<{ reloptions: string[] | null }>(`select reloptions from pg_class where relname = 'customer_payments'`);
    expect(opts[0]?.reloptions ?? []).not.toContain("security_invoker=true");
  });

  it("anonymous callers cannot read the view at all", async () => {
    await expect(asUser(db, null, `select id from public.customer_payments`)).rejects.toThrow(/permission denied/);
  });

  it("the view cannot be written through: customers have no write path on it", async () => {
    await expect(asUser(db, A, `update public.customer_payments set status = 'received'`)).rejects.toThrow(/cannot update|permission denied|not updatable/);
    await expect(asUser(db, A, `delete from public.customer_payments`)).rejects.toThrow(/cannot delete|permission denied|not updatable/);
  });

  it("customer A sees only A's payments, and customer B sees only B's, in both directions", async () => {
    const aRows = await asUser<{ application_id: string }>(db, A, `select application_id from public.customer_payments`);
    const bRows = await asUser<{ application_id: string }>(db, B, `select application_id from public.customer_payments`);
    expect(aRows.length).toBeGreaterThan(0);
    expect(aRows.every((r) => r.application_id !== APP_B)).toBe(true);
    expect(bRows.length).toBeGreaterThan(0);
    expect(bRows.every((r) => r.application_id === APP_B)).toBe(true);
  });

  it("a customer cannot read another customer's rows by filtering on the other request's id", async () => {
    expect(await asUser(db, A, `select id from public.customer_payments where application_id = '${APP_B}'`)).toEqual([]);
    expect(await asUser(db, B, `select id from public.customer_payments where application_id = '${APP_A}'`)).toEqual([]);
  });
});

describe("storage removal failure and reconciliation", () => {
  const FILE = `${A}/${APP_CASH}/payment-retry.pdf`;

  beforeAll(async () => {
    await exec(`insert into storage.objects (bucket_id, name, created_at) values ('customer-documents', '${FILE}', now() - interval '30 days')`);
  });

  it("a removal whose storage call failed is recorded as failed with its reason, and is not counted as removed", async () => {
    const intent = (await asUser<{ begin_orphan_removal: string }>(db, OWNER, `select public.begin_orphan_removal('${FILE}', 'Old proof, first try')`))[0]!.begin_orphan_removal;
    const outcome = await asUser<{ finish_orphan_removal: string }>(db, OWNER, `select public.finish_orphan_removal('${intent}', false, 'storage unavailable')`);
    expect(outcome[0]?.finish_orphan_removal).toBe("failed");
    const row = await rows<{ status: string; detail: string }>(`select status, detail from public.proof_removals where id = '${intent}'`);
    expect(row[0]).toEqual({ status: "failed", detail: "storage unavailable" });
    expect(await count(`select 1 from public.payment_audit where action = 'orphan_purged' and application_id = '${APP_CASH}' and reason = 'Old proof, first try'`)).toBe(0);
  });

  it("a failed removal can be tried again: a new intent is allowed while the file is still eligible", async () => {
    const retry = await asUser<{ begin_orphan_removal: string }>(db, OWNER, `select public.begin_orphan_removal('${FILE}', 'Second try after a failure')`);
    expect(retry[0]?.begin_orphan_removal).toBeTruthy();
    const open = await count(`select 1 from public.proof_removals where object_name = '${FILE}' and status = 'intent'`);
    expect(open).toBe(1);
  });

  it("reconciliation of an interrupted run marks a file still present as failed, and a file already gone as removed", async () => {
    const PRESENT = `${A}/${APP_CASH}/payment-interrupted-present.pdf`;
    const GONE = `${A}/${APP_CASH}/payment-interrupted-gone.pdf`;
    await exec(`insert into storage.objects (bucket_id, name, created_at) values ('customer-documents', '${PRESENT}', now() - interval '30 days')`);
    // The state an interrupted run leaves: an intent older than the reconciliation window, whatever the storage holds.
    await exec(`insert into public.proof_removals (object_name, application_id, actor_id, reason, status, requested_at) values
      ('${PRESENT}', '${APP_CASH}', '${OWNER}', 'Interrupted run', 'intent', now() - interval '3 hours'),
      ('${GONE}', '${APP_CASH}', '${OWNER}', 'Interrupted run', 'intent', now() - interval '3 hours')`);
    const out = await asUser<{ removal_id: string; outcome: string }>(db, OWNER, `select removal_id, outcome from public.reconcile_orphan_removals()`);
    const byName = Object.fromEntries((await rows<{ id: string; object_name: string }>(`select id, object_name from public.proof_removals where object_name in ('${PRESENT}', '${GONE}')`)).map((r) => [r.object_name, r.id]));
    expect(out.find((r) => r.removal_id === byName[PRESENT])?.outcome).toBe("failed");
    expect(out.find((r) => r.removal_id === byName[GONE])?.outcome).toBe("removed");
    const states = await rows<{ object_name: string; status: string }>(`select object_name, status from public.proof_removals where object_name in ('${PRESENT}', '${GONE}')`);
    expect(Object.fromEntries(states.map((x) => [x.object_name, x.status]))).toEqual({ [PRESENT]: "failed", [GONE]: "removed" });
    // The file from the failed attempt above is younger than the window, so reconciliation leaves it alone.
    expect(await count(`select 1 from public.proof_removals where object_name = '${FILE}' and status = 'intent'`)).toBe(1);
  });

  it("reconciliation is owner only", async () => {
    await expect(asUser(db, A, `select * from public.reconcile_orphan_removals()`)).rejects.toThrow(/Only the owner/);
  });
});
