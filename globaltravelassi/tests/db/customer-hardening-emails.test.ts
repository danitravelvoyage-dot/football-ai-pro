import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/**
 * Migrations 0020 (customer write hardening) and 0021 (customer email log), applied on 0001 + 0019 only: the customer
 * launch path, without the AI migrations. PGlite only; no live database is touched.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ALICE = "00000000-0000-0000-0000-0000000000b1";
const BOB = "00000000-0000-0000-0000-0000000000b2";
const CAROL = "00000000-0000-0000-0000-0000000000b3"; // disabled account
const read = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");

let db: PGlite;
let serviceId: string;
let aliceApp: string;
let bobApp: string;
let carolApp: string;

async function expectDenied(p: Promise<unknown>, pattern?: RegExp) {
  if (pattern) await expect(p).rejects.toThrow(pattern);
  else await expect(p).rejects.toThrow();
}

const appInsert = (user: string, extra = "") => `
  insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence,
    destination_country, employment_status${extra ? ", " + extra.split("=")[0] : ""})
  values ('${user}', '${serviceId}', 'Test Person', 't@example.dz', '+213555123456', 'DZ', 'DZ', 'FR', 'employed'${extra ? ", " + extra.split("=")[1] : ""})
  returning id`;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(read("0019_manual_payments.sql"));
  await db.exec(read("0020_customer_hardening.sql"));
  await db.exec(read("0021_customer_email_notifications.sql"));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'),
      ('${ALICE}', 'Alice@Example.dz', '{"full_name":"Alice A"}'),
      ('${BOB}', 'bob@example.dz', '{}'),
      ('${CAROL}', 'carol@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    update public.profiles set is_active = false where id = '${CAROL}';
    update public.services set price = 15000 where slug = 'visa-consulting';
  `);
  serviceId = (await db.query<{ id: string }>("select id from public.services where slug='visa-consulting'")).rows[0]!.id;
  aliceApp = (await asUser<{ id: string }>(db, ALICE, appInsert(ALICE, "locale='fr'")))[0]!.id;
  bobApp = (await asUser<{ id: string }>(db, BOB, appInsert(BOB, "locale='en'")))[0]!.id;
  carolApp = (await db.query<{ id: string }>(appInsert(CAROL))).rows[0]!.id; // created before the account was disabled
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("0020: customer writes", () => {
  it("records the language of a request", async () => {
    const rows = await db.query<{ locale: string }>(`select locale from public.applications where id = '${aliceApp}'`);
    expect(rows.rows[0]!.locale).toBe("fr");
    const def = await db.query<{ locale: string }>(`select locale from public.applications where id = '${carolApp}'`);
    expect(def.rows[0]!.locale).toBe("ar");
  });

  it("does not let a customer choose the reference, id or dates of a request", async () => {
    await expectDenied(asUser(db, ALICE, appInsert(ALICE, "reference='GTA-FAKE-1'")), /permission denied/);
    await expectDenied(asUser(db, ALICE, appInsert(ALICE, "id='00000000-0000-4000-8000-000000000999'")), /permission denied/);
    await expectDenied(asUser(db, ALICE, appInsert(ALICE, "created_at='2000-01-01'")), /permission denied/);
  });

  it("refuses new requests from a disabled account", async () => {
    await expectDenied(asUser(db, CAROL, appInsert(CAROL)));
  });

  it("refuses a document that arrives already verified", async () => {
    await expectDenied(
      asUser(db, ALICE, `insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes, verified)
        values ('${aliceApp}', '${ALICE}', 'passport', '${ALICE}/${aliceApp}/v.pdf', 'v.pdf', 'application/pdf', 10, true)`),
      /permission denied/,
    );
  });

  it("refuses a document row that points outside the request's own folder", async () => {
    const ins = (path: string) => asUser(db, ALICE, `insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
      values ('${aliceApp}', '${ALICE}', 'passport', '${path}', 'p.pdf', 'application/pdf', 10) returning id`);
    await expectDenied(ins(`${BOB}/${bobApp}/passport.pdf`));
    await expectDenied(ins(`${ALICE}/${bobApp}/passport.pdf`));
    await expectDenied(ins(`passport.pdf`));
    const ok = await ins(`${ALICE}/${aliceApp}/passport.pdf`);
    expect(ok).toHaveLength(1);
  });

  it("stops a disabled account from uploading files", async () => {
    await expectDenied(asUser(db, CAROL, `insert into storage.objects (bucket_id, name, owner) values ('customer-documents', '${CAROL}/${carolApp}/x.pdf', '${CAROL}')`));
    await asUser(db, ALICE, `insert into storage.objects (bucket_id, name, owner) values ('customer-documents', '${ALICE}/${aliceApp}/ok.pdf', '${ALICE}')`);
  });

  it("loads the launch catalogue: the nine business services, no price set, safe to re-run", async () => {
    const seed = readFileSync(resolve(__dirname, "../../supabase/seed_catalog.sql"), "utf8");
    await db.exec(seed);
    await db.exec(seed);
    const slugs = ["france-visa-appointment", "appointment-assistance", "visa-consulting", "visa-file-assistance", "e-visa", "flight-booking", "hotel-booking", "travel-itinerary", "transit-airport"];
    const rows = await asUser<{ slug: string; price: string | null }>(db, null, `select slug, price from public.services where slug = any($1)`, [slugs]);
    expect(rows.map((r) => r.slug).sort()).toEqual([...slugs].sort());
    expect(rows.filter((r) => r.slug !== "visa-consulting").every((r) => r.price === null)).toBe(true);
  });

  it("accepts the booking and itinerary service categories", async () => {
    await asUser(db, ADMIN, `insert into public.services (slug, category, title_ar, title_fr, title_en) values ('test-booking', 'booking', 'حجز', 'Vol', 'Flight')`);
    await expectDenied(asUser(db, ADMIN, `insert into public.services (slug, category, title_ar, title_fr, title_en) values ('bad-category', 'cruise', 'x', 'xx', 'xx')`));
  });
});

type Queued = { email_id: string; email_recipient: string; email_locale: string; email_data: Record<string, unknown>; email_status: string };
const enqueue = (user: string, kind: string, subject: string) =>
  asUser<Queued>(db, user, `select * from public.enqueue_customer_email($1, $2::uuid)`, [kind, subject]);

describe("0021: queueing customer emails", () => {
  let receivedId: string;

  it("queues the request-received email to the owner's account address, in the request's language", async () => {
    const rows = await enqueue(ALICE, "application_received", aliceApp);
    expect(rows).toHaveLength(1);
    receivedId = rows[0]!.email_id;
    expect(rows[0]!.email_recipient).toBe("alice@example.dz");
    expect(rows[0]!.email_locale).toBe("fr");
    expect(rows[0]!.email_status).toBe("pending");
    expect(rows[0]!.email_data).toMatchObject({ application_id: aliceApp, customer_name: "Alice A", service_title_fr: "Conseil visa" });
  });

  it("never queues the same email twice", async () => {
    expect(await enqueue(ALICE, "application_received", aliceApp)).toHaveLength(0);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.customer_email_notifications where dedupe_key = 'application_received:${aliceApp}'`);
    expect(count.rows[0]!.n).toBe(1);
  });

  it("does not let a customer queue an email about someone else's request, nor an owner-only email", async () => {
    await expectDenied(enqueue(BOB, "application_received", aliceApp), /not found/);
    await expectDenied(enqueue(ALICE, "application_approved", aliceApp), /Only the owner/);
    await expectDenied(enqueue(ALICE, "nonsense", aliceApp), /Unknown email kind/);
  });

  it("does not let a disabled account queue emails", async () => {
    await expectDenied(enqueue(CAROL, "application_received", carolApp), /disabled/);
  });

  it("requires the email to match the status the owner set, and carries the customer-visible message only", async () => {
    await asUser(db, ADMIN, `insert into public.application_notes (application_id, author_id, body) values ('${aliceApp}', '${ADMIN}', 'INTERNAL-NOTE-123')`);
    const ev = await asUser<{ id: string }>(db, ADMIN, `insert into public.application_events (application_id, kind, to_status, message, actor_id)
      values ('${aliceApp}', 'status', 'documents_required', 'Ajoutez un relevé bancaire', '${ADMIN}') returning id`);
    await expectDenied(enqueue(ADMIN, "application_approved", ev[0]!.id), /does not match/);
    const rows = await enqueue(ADMIN, "additional_documents_requested", ev[0]!.id);
    expect(rows[0]!.email_data).toMatchObject({ status: "documents_required", message: "Ajoutez un relevé bancaire" });
    expect(JSON.stringify(rows[0])).not.toContain("INTERNAL-NOTE-123");
  });

  it("queues one review email per document and verification state", async () => {
    const doc = await db.query<{ id: string }>(`select id from public.documents where application_id = '${aliceApp}' limit 1`);
    const docId = doc.rows[0]!.id;
    expect((await enqueue(ALICE, "document_upload_confirmed", docId))[0]!.email_data).toMatchObject({ doc_type: "passport" });
    await expectDenied(enqueue(ALICE, "document_review_result", docId), /Only the owner/);
    await asUser(db, ADMIN, `update public.documents set verified = true where id = '${docId}'`);
    expect(await enqueue(ADMIN, "document_review_result", docId)).toHaveLength(1);
    expect(await enqueue(ADMIN, "document_review_result", docId)).toHaveLength(0);
  });

  describe("delivery log", () => {
    it("lets only the session that queued an email (or the owner) record its result, once", async () => {
      await expectDenied(asUser(db, BOB, `select public.record_customer_email_delivery('${receivedId}', 'sent', null, '<m@x>')`), /not found/);
      await asUser(db, ALICE, `select public.record_customer_email_delivery('${receivedId}', 'sent', null, '<m@x>')`);
      await expectDenied(asUser(db, ALICE, `select public.record_customer_email_delivery('${receivedId}', 'failed', 'timeout', null)`), /not waiting/);
      const row = await db.query<{ status: string; attempts: number; sent_at: string | null }>(`select status, attempts, sent_at from public.customer_email_notifications where id = '${receivedId}'`);
      expect(row.rows[0]).toMatchObject({ status: "sent", attempts: 1 });
      expect(row.rows[0]!.sent_at).not.toBeNull();
    });

    it("stores only a short error code, whatever text the caller sends", async () => {
      const q = await enqueue(BOB, "application_received", bobApp);
      await asUser(db, BOB, `select public.record_customer_email_delivery('${q[0]!.email_id}', 'failed', 'Error: 535 password=hunter2 for bob@example.dz', null)`);
      const row = await db.query<{ last_error: string }>(`select last_error from public.customer_email_notifications where id = '${q[0]!.email_id}'`);
      expect(row.rows[0]!.last_error).toBe("send_failed");
    });

    it("lets only the owner claim a failed email for a retry, and only once at a time", async () => {
      const failed = await db.query<{ id: string }>(`select id from public.customer_email_notifications where status = 'failed' limit 1`);
      const id = failed.rows[0]!.id;
      await expectDenied(asUser(db, BOB, `select * from public.claim_customer_email_retry('${id}')`), /Only the owner/);
      expect(await asUser(db, ADMIN, `select * from public.claim_customer_email_retry('${id}')`)).toHaveLength(1);
      expect(await asUser(db, ADMIN, `select * from public.claim_customer_email_retry('${id}')`)).toHaveLength(0);
      await asUser(db, ADMIN, `select public.record_customer_email_delivery('${id}', 'sent', null, '<r@x>')`);
    });

    it("is readable by the owner only, and no client role can write or delete it directly", async () => {
      expect(await asUser(db, ALICE, `select id from public.customer_email_notifications`)).toHaveLength(0);
      expect((await asUser(db, ADMIN, `select id from public.customer_email_notifications`)).length).toBeGreaterThan(3);
      await expectDenied(asUser(db, ADMIN, `update public.customer_email_notifications set status = 'pending'`), /permission denied/);
      await expectDenied(asUser(db, ADMIN, `delete from public.customer_email_notifications`), /permission denied/);
      await expectDenied(asUser(db, ALICE, `insert into public.customer_email_notifications (dedupe_key, kind, locale) values ('x:12345678', 'application_received', 'en')`), /permission denied/);
      await expectDenied(db.query(`delete from public.customer_email_notifications`), /kept/);
      await expectDenied(db.query(`update public.customer_email_notifications set recipient = 'x@evil.test' where status = 'sent'`));
    });

    it("keeps the record of a sent email when its request is deleted", async () => {
      const sent = await db.query<{ id: string }>(`select id from public.customer_email_notifications where application_id = '${bobApp}' and status = 'sent'`);
      expect(sent.rows).toHaveLength(1);
      await asUser(db, ADMIN, `select public.delete_application_request('${bobApp}')`);
      const after = await db.query<{ application_id: string | null; status: string }>(`select application_id, status from public.customer_email_notifications where id = '${sent.rows[0]!.id}'`);
      expect(after.rows[0]).toEqual({ application_id: null, status: "sent" });
    });
  });
});
