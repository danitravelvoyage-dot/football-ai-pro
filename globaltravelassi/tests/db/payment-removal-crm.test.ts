import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Migrations 0022 (payment workflow removed, history kept) and 0023 (CRM, lead source, duplicate protection, rate
 * limiting), on PGlite only. No live database is touched.
 */

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const apply = async (db: PGlite, from: string, to: string) => {
  for (const f of files) if (f >= from && f < to) await db.exec(readFileSync(resolve(DIR, f), "utf8"));
};

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ALICE = "00000000-0000-0000-0000-0000000000b1";
const BOB = "00000000-0000-0000-0000-0000000000b2";

let db: PGlite;
let serviceId: string;
let aliceApp: string;
let bobApp: string;
const PAYMENT_ID = "00000000-0000-4000-8000-00000000f001";

beforeAll(async () => {
  db = await createTestDb();
  // Stage 1: the payment workflow exists, with data in it (as it would on a project that applied 0019).
  await apply(db, "0002", "0020");
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${ALICE}', 'alice@example.dz', '{}'), ('${BOB}', 'bob@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    update public.services set price = 15000 where slug = 'visa-consulting';
  `);
  serviceId = (await db.query<{ id: string }>("select id from public.services where slug='visa-consulting'")).rows[0]!.id;
  aliceApp = (await db.query<{ id: string }>(`insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, status)
    values ('${ALICE}', '${serviceId}', 'Alice A', 'a@example.dz', '+213555123456', 'DZ', 'DZ', 'FR', 'employed', 'approved') returning id`)).rows[0]!.id;
  bobApp = (await db.query<{ id: string }>(`insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status)
    values ('${BOB}', '${serviceId}', 'Bob B', 'b@example.dz', '+213555123457', 'DZ', 'DZ', 'FR', 'employed') returning id`)).rows[0]!.id;
  await db.exec(`insert into public.payments (id, application_id, amount, currency, method, status, received_at)
    values ('${PAYMENT_ID}', '${aliceApp}', 15000, 'DZD', 'cash', 'received', now())`);
  await db.exec(`insert into public.application_events (application_id, kind, to_status, message, actor_id)
    values ('${aliceApp}', 'payment', 'received', 'Payment confirmed', '${ADMIN}')`);
  // Stage 2: the rest of the chain, including the two new migrations.
  await apply(db, "0020", "9999");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0022: the payment workflow is removed, its history is kept", () => {
  it("drops the payment functions", async () => {
    const r = await db.query<{ fn: string | null }>(`select to_regprocedure('public.decide_payment(uuid,text,text,text)')::text as fn`);
    expect(r.rows[0]!.fn).toBeNull();
    const r2 = await db.query<{ fn: string | null }>(`select to_regprocedure('public.submit_payment_evidence(uuid,text,text,text,integer,text)')::text as fn`);
    expect(r2.rows[0]!.fn).toBeNull();
  });

  it("keeps every historical payment row", async () => {
    const rows = await db.query<{ id: string; status: string; amount: string }>(`select id, status, amount from public.payments where id = '${PAYMENT_ID}'`);
    expect(rows.rows).toEqual([{ id: PAYMENT_ID, status: "received", amount: "15000.00" }]);
  });

  it("removes the customer payment view", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.views where table_schema = 'public' and table_name = 'customer_payments'`);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("denies every signed-in user direct access to the payment tables", async () => {
    await expect(asUser(db, ALICE, "select id from public.payments")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ADMIN, "select id from public.payments")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ALICE, "select method from public.payment_method_settings")).rejects.toThrow(/permission denied/);
  });

  it("hides payment events from the customer timeline, but keeps them in the table", async () => {
    expect(await asUser(db, ALICE, `select id from public.customer_application_events where application_id = '${aliceApp}' and kind = 'payment'`)).toHaveLength(0);
    const kept = await db.query<{ n: number }>(`select count(*)::int as n from public.application_events where kind = 'payment'`);
    expect(kept.rows[0]!.n).toBeGreaterThan(0);
  });

  it("refuses payment emails, and keeps the non-payment ones", async () => {
    await expect(db.query(`insert into public.customer_email_notifications (dedupe_key, kind, locale) values ('payment_approved:x-1234567', 'payment_approved', 'en')`)).rejects.toThrow(/no longer sent/);
    await db.query(`insert into public.customer_email_notifications (dedupe_key, kind, locale) values ('application_received:x-1234567', 'application_received', 'en')`);
  });

  it("hides the European trips and travel consultation services, without deleting them", async () => {
    const r = await db.query<{ slug: string; is_active: boolean }>(`select slug, is_active from public.services where slug in ('european-trips', 'travel-consultation') order by slug`);
    expect(r.rows).toEqual([{ slug: "european-trips", is_active: false }, { slug: "travel-consultation", is_active: false }]);
  });
});

describe("0023: lead source attribution", () => {
  it("lets the customer record the source of a new request, but not change it afterwards", async () => {
    const id = (await asUser<{ id: string }>(db, BOB, `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, lead_source, lead_source_detail, submission_token)
      values ('${BOB}', '${serviceId}', 'Bob B', 'b@example.dz', '+213555123457', 'DZ', 'DZ', 'FR', 'employed', 'tiktok', 'summer26', '11111111-2222-4333-8444-555555555555') returning id`))[0]!.id;
    expect(id).toBeTruthy();
    const changed = await asUser(db, BOB, `update public.applications set lead_source = 'google' where id = '${id}' returning id`);
    expect(changed).toHaveLength(0);
  });

  it("refuses a second request with the same submission token from the same customer", async () => {
    await expect(asUser(db, BOB, `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status, submission_token)
      values ('${BOB}', '${serviceId}', 'Bob B', 'b@example.dz', '+213555123457', 'DZ', 'DZ', 'FR', 'employed', '11111111-2222-4333-8444-555555555555')`)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("records a first source once, and refuses a silent change to a recorded source", async () => {
    await db.exec(`update public.applications set lead_source = null where id = '${aliceApp}'`);
    await db.exec(`update public.applications set lead_source = 'instagram' where id = '${aliceApp}'`);
    await expect(db.query(`update public.applications set lead_source = 'google' where id = '${aliceApp}'`)).rejects.toThrow(/administrator/);
    await db.exec(`update public.applications set lead_source = 'google', lead_source_corrected_by = '${ADMIN}', lead_source_corrected_at = now() where id = '${aliceApp}'`);
    const r = await db.query<{ lead_source: string }>(`select lead_source from public.applications where id = '${aliceApp}'`);
    expect(r.rows[0]!.lead_source).toBe("google");
  });

  it("refuses a lead source outside the known list", async () => {
    await expect(db.query(`update public.applications set lead_source = 'newspaper' where id = '${bobApp}'`)).rejects.toThrow();
  });

  it("uses a reference with 10 random hex characters by default", async () => {
    const r = await db.query<{ reference: string }>(`insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status)
      values ('${ALICE}', '${serviceId}', 'Alice A', 'a@example.dz', '+213555123456', 'DZ', 'DZ', 'FR', 'employed') returning reference`);
    expect(r.rows[0]!.reference).toMatch(/^GTA-\d{4}-[0-9A-F]{10}$/);
  });
});

describe("0023: CRM activity is kept and cannot be edited", () => {
  it("lets an administrator record activity under their own identity", async () => {
    await asUser(db, ADMIN, `insert into public.crm_activity (application_id, actor_id, kind, detail) values ('${aliceApp}', '${ADMIN}', 'contact_logged', 'whatsapp: sent the list')`);
    expect(await asUser(db, ADMIN, `select id from public.crm_activity where application_id = '${aliceApp}'`)).toHaveLength(1);
  });

  it("refuses an activity record under another person's identity", async () => {
    await expect(asUser(db, ADMIN, `insert into public.crm_activity (application_id, actor_id, kind, detail) values ('${aliceApp}', '${ALICE}', 'contact_logged', 'x')`)).rejects.toThrow();
  });

  it("refuses edits and deletes of activity records, even by the database owner", async () => {
    await expect(db.query(`update public.crm_activity set detail = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.crm_activity`)).rejects.toThrow(/append-only/);
  });

  it("hides the activity from customers", async () => {
    expect(await asUser(db, ALICE, `select id from public.crm_activity`)).toHaveLength(0);
  });
});

describe("0023: rate limiting", () => {
  it("allows the first requests inside the limit and refuses the next", async () => {
    const key = "apply-account:testkey01";
    expect(await asUser(db, BOB, `select public.consume_rate_limit($1, 2, interval '1 hour') as ok`, [key])).toEqual([{ ok: true }]);
    expect(await asUser(db, BOB, `select public.consume_rate_limit($1, 2, interval '1 hour') as ok`, [key])).toEqual([{ ok: true }]);
    expect(await asUser(db, BOB, `select public.consume_rate_limit($1, 2, interval '1 hour') as ok`, [key])).toEqual([{ ok: false }]);
  });

  it("refuses unsafe parameters and anonymous callers", async () => {
    await expect(asUser(db, BOB, `select public.consume_rate_limit('short', 2, interval '1 hour')`)).rejects.toThrow();
    await expect(asUser(db, BOB, `select public.consume_rate_limit('apply-account:xyz9876', 2000, interval '1 hour')`)).rejects.toThrow();
    await expect(asUser(db, null, `select public.consume_rate_limit('apply-account:xyz9876', 2, interval '1 hour')`)).rejects.toThrow();
  });

  it("keeps the counters out of reach of signed-in users", async () => {
    await expect(asUser(db, BOB, `select bucket_key from public.rate_limit_hits`)).rejects.toThrow(/permission denied/);
  });
});
