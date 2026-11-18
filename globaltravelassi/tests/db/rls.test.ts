import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ALICE = "00000000-0000-0000-0000-0000000000b1";
const BOB = "00000000-0000-0000-0000-0000000000b2";

let db: PGlite;
let serviceId: string;
let inactiveServiceId: string;
let aliceAppId: string;
let bobAppId: string;

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
}

/** Row-level security silently filters UPDATEs: the statement succeeds but changes nothing. */
async function expectNoRowsUpdated(p: Promise<unknown[]>) {
  expect(await p).toHaveLength(0);
}

beforeAll(async () => {
  db = await createTestDb();
  // Create users through the real auth trigger (superuser context, as Supabase does on sign-up).
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'admin@example.dz', '{}'),
      ('${ALICE}', 'alice@example.dz', '{"full_name":"Alice","whatsapp":"+213555000111","role":"admin"}'),
      ('${BOB}', 'bob@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
  `);
  const [svc] = (await db.query<{ id: string }>("select id from public.services where slug='visa-consulting'")).rows;
  serviceId = svc.id;
  await db.exec(`insert into public.services (slug, category, title_ar, title_fr, title_en, is_active)
                 values ('hidden-service','visa','Hidden AR','Hidden FR','Hidden EN', false)`);
  inactiveServiceId = (await db.query<{ id: string }>("select id from public.services where slug='hidden-service'")).rows[0].id;

  const insertApp = (userId: string) => `
    insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
      country_of_residence, destination_country, employment_status)
    values ('${userId}', '${serviceId}', 'Test Person', 't@example.dz', '+213555123456', 'DZ', 'DZ', 'FR', 'employed')
    returning id`;
  aliceAppId = (await db.query<{ id: string }>(insertApp(ALICE))).rows[0].id;
  bobAppId = (await db.query<{ id: string }>(insertApp(BOB))).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

describe("profiles and the auth trigger", () => {
  it("creates a customer profile on sign-up and ignores a role supplied in metadata", async () => {
    const rows = await db.query<{ role: string; full_name: string; whatsapp: string }>(
      `select role, full_name, whatsapp from public.profiles where id = '${ALICE}'`,
    );
    expect(rows.rows[0]).toEqual({ role: "customer", full_name: "Alice", whatsapp: "+213555000111" });
  });

  it("lets a customer update their own name", async () => {
    await asUser(db, ALICE, `update public.profiles set full_name = 'Alice B' where id = '${ALICE}'`);
    const rows = await db.query<{ full_name: string }>(`select full_name from public.profiles where id='${ALICE}'`);
    expect(rows.rows[0].full_name).toBe("Alice B");
  });

  it("blocks a customer from promoting themselves to admin", async () => {
    await expectDenied(asUser(db, ALICE, `update public.profiles set role = 'admin' where id = '${ALICE}'`));
    const rows = await db.query<{ role: string }>(`select role from public.profiles where id='${ALICE}'`);
    expect(rows.rows[0].role).toBe("customer");
  });

  it("does not let a customer see or edit another customer's profile", async () => {
    const seen = await asUser(db, ALICE, `select id from public.profiles where id = '${BOB}'`);
    expect(seen).toHaveLength(0);
    await expectNoRowsUpdated(asUser(db, ALICE, `update public.profiles set full_name = 'hacked' where id = '${BOB}' returning id`));
    const rows = await db.query<{ full_name: string }>(`select full_name from public.profiles where id='${BOB}'`);
    expect(rows.rows[0].full_name).toBe("");
  });

  it("lets an admin list every profile", async () => {
    const rows = await asUser(db, ADMIN, "select id from public.profiles");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("services", () => {
  it("shows active services to visitors but hides inactive ones", async () => {
    const visible = await asUser(db, null, "select slug from public.services order by sort_order");
    expect(visible.map((r) => r.slug)).toContain("visa-consulting");
    expect(visible.map((r) => r.slug)).not.toContain("hidden-service");
  });

  it("starts with no prices set (price on request)", async () => {
    const rows = await asUser<{ price: string | null }>(db, null, "select price from public.services");
    expect(rows.every((r) => r.price === null)).toBe(true);
  });

  it("only admins can change services", async () => {
    await expectNoRowsUpdated(asUser(db, ALICE, `update public.services set price = 1 where id = '${serviceId}' returning id`));
    const unchanged = await db.query<{ price: string | null }>(`select price from public.services where id = '${serviceId}'`);
    expect(unchanged.rows[0].price).toBeNull();
    const rows = await asUser(db, ADMIN, `update public.services set price = 15000 where id = '${serviceId}' returning price`);
    expect(Number(rows[0].price)).toBe(15000);
  });
});

describe("applications", () => {
  it("lets a customer create a request for themselves", async () => {
    const rows = await asUser(
      db,
      BOB,
      `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
         country_of_residence, destination_country, employment_status)
       values ('${BOB}', '${serviceId}', 'Bob Two', 'b@example.dz', '+213555999888', 'DZ', 'DZ', 'DE', 'student')
       returning id, status`,
    );
    expect(rows[0]).toMatchObject({ status: "new" });
  });

  it("refuses a request on behalf of another user", async () => {
    await expectDenied(
      asUser(
        db,
        BOB,
        `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
           country_of_residence, destination_country, employment_status)
         values ('${ALICE}', '${serviceId}', 'Fake', 'f@example.dz', '+213555999888', 'DZ', 'DZ', 'DE', 'student')`,
      ),
    );
  });

  it("refuses a request that starts already approved", async () => {
    await expectDenied(
      asUser(
        db,
        BOB,
        `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
           country_of_residence, destination_country, employment_status, status)
         values ('${BOB}', '${serviceId}', 'Fake', 'f@example.dz', '+213555999888', 'DZ', 'DZ', 'DE', 'student', 'approved')`,
      ),
    );
  });

  it("refuses a request for an inactive service", async () => {
    await expectDenied(
      asUser(
        db,
        BOB,
        `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
           country_of_residence, destination_country, employment_status)
         values ('${BOB}', '${inactiveServiceId}', 'Bob', 'b@example.dz', '+213555999888', 'DZ', 'DZ', 'DE', 'student')`,
      ),
    );
  });

  it("keeps each customer's requests private from the other", async () => {
    const seen = await asUser(db, ALICE, "select id from public.applications");
    expect(seen.map((r) => r.id)).toEqual([aliceAppId]);
  });

  it("stops a customer from changing the status of their own request", async () => {
    await expectNoRowsUpdated(asUser(db, ALICE, `update public.applications set status = 'approved' where id = '${aliceAppId}' returning id`));
    const row = await db.query<{ status: string }>(`select status from public.applications where id = '${aliceAppId}'`);
    expect(row.rows[0].status).not.toBe("approved");
  });

  it("lets an admin read everything and change status", async () => {
    const all = await asUser(db, ADMIN, "select id from public.applications");
    expect(all.length).toBeGreaterThanOrEqual(2);
    const updated = await asUser(db, ADMIN, `update public.applications set status = 'in_review' where id = '${aliceAppId}' returning status`);
    expect(updated[0].status).toBe("in_review");
  });

  it("rejects malformed data at the database level (bad WhatsApp, bad country code)", async () => {
    await expectDenied(
      asUser(
        db,
        BOB,
        `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
           country_of_residence, destination_country, employment_status)
         values ('${BOB}', '${serviceId}', 'Bob', 'b@example.dz', 'call me', 'DZ', 'DZ', 'DE', 'student')`,
      ),
    );
    await expectDenied(
      asUser(
        db,
        BOB,
        `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
           country_of_residence, destination_country, employment_status)
         values ('${BOB}', '${serviceId}', 'Bob', 'b@example.dz', '+213555999888', 'Algeria', 'DZ', 'DE', 'student')`,
      ),
    );
  });
});

describe("documents, payments, notes and timeline", () => {
  let docId: string;

  it("lets the owner register a document on their own request and blocks others from doing so", async () => {
    const rows = await asUser<{ id: string }>(
      db,
      BOB,
      `insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
       values ('${bobAppId}', '${BOB}', 'passport', '${BOB}/${bobAppId}/p.pdf', 'p.pdf', 'application/pdf', 1000)
       returning id`,
    );
    docId = rows[0].id;
    await expectDenied(
      asUser(
        db,
        ALICE,
        `insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
         values ('${bobAppId}', '${ALICE}', 'passport', 'x/y.pdf', 'y.pdf', 'application/pdf', 1000)`,
      ),
    );
  });

  it("blocks new uploads once the admin has started reviewing the request", async () => {
    // Alice's request was moved to 'in_review' by an admin earlier in this suite.
    await expectDenied(
      asUser(
        db,
        ALICE,
        `insert into public.documents (application_id, user_id, doc_type, storage_path, file_name, mime_type, size_bytes)
         values ('${aliceAppId}', '${ALICE}', 'passport', '${ALICE}/${aliceAppId}/late.pdf', 'late.pdf', 'application/pdf', 1000)`,
      ),
    );
  });

  it("does not let the owner mark their own document as verified", async () => {
    await expectNoRowsUpdated(asUser(db, BOB, `update public.documents set verified = true where id = '${docId}' returning id`));
    const row = await db.query<{ verified: boolean }>(`select verified from public.documents where id = '${docId}'`);
    expect(row.rows[0].verified).toBe(false);
  });

  it("does not show a customer another customer's documents", async () => {
    const seen = await asUser(db, ALICE, "select id from public.documents");
    expect(seen).toHaveLength(0);
  });

  it("lets an admin verify a document", async () => {
    const rows = await asUser<{ verified: boolean }>(db, ADMIN, `update public.documents set verified = true where id = '${docId}' returning verified`);
    expect(rows[0].verified).toBe(true);
  });

  it("records a payment only by an admin, and shows it to the owner only", async () => {
    await expectDenied(
      asUser(db, ALICE, `insert into public.payments (application_id, amount, status) values ('${aliceAppId}', 5000, 'pending')`),
    );
    await asUser(
      db,
      ADMIN,
      `insert into public.payments (application_id, amount, currency, method, status, received_at, created_by)
       values ('${aliceAppId}', 5000, 'DZD', 'cash', 'received', now(), '${ADMIN}')`,
    );
    expect(await asUser(db, ALICE, "select amount from public.payments")).toHaveLength(1);
    expect(await asUser(db, BOB, "select amount from public.payments")).toHaveLength(0);
    expect(await asUser(db, ALICE, "select amount from public.payments")).toHaveLength(1);
  });

  it("refuses to mark a payment received without a date", async () => {
    await expectDenied(
      asUser(db, ADMIN, `insert into public.payments (application_id, amount, status) values ('${aliceAppId}', 100, 'received')`),
    );
  });

  it("keeps internal notes invisible to customers", async () => {
    await asUser(db, ADMIN, `insert into public.application_notes (application_id, author_id, body) values ('${aliceAppId}', '${ADMIN}', 'internal')`);
    expect(await asUser(db, ALICE, "select id from public.application_notes")).toHaveLength(0);
    expect(await asUser(db, ADMIN, "select id from public.application_notes")).toHaveLength(1);
  });

  it("lets the owner read the timeline but not write it", async () => {
    await asUser(db, ADMIN, `insert into public.application_events (application_id, kind, to_status, message, actor_id) values ('${aliceAppId}', 'status', 'in_review', 'Review started', '${ADMIN}')`);
    // Alice's request has the automatic 'created' entry plus the admin's status change.
    const forAlice = `select id from public.application_events where application_id = '${aliceAppId}'`;
    expect(await asUser(db, ALICE, forAlice)).toHaveLength(2);
    expect(await asUser(db, BOB, forAlice)).toHaveLength(0);
    await expectDenied(asUser(db, ALICE, `insert into public.application_events (application_id, kind, message) values ('${aliceAppId}', 'status', 'x')`));
  });
});

describe("private document bucket", () => {
  it("is private, size-limited and limited to PDF/JPEG/PNG", async () => {
    const rows = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id='customer-documents'",
    );
    expect(rows.rows[0].public).toBe(false);
    expect(Number(rows.rows[0].file_size_limit)).toBe(10485760);
    expect(rows.rows[0].allowed_mime_types.sort()).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });

  it("lets a customer upload only inside their own folder", async () => {
    await asUser(db, ALICE, `insert into storage.objects (bucket_id, name, owner) values ('customer-documents', '${ALICE}/${aliceAppId}/a.pdf', '${ALICE}')`);
    await expectDenied(
      asUser(db, ALICE, `insert into storage.objects (bucket_id, name, owner) values ('customer-documents', '${BOB}/${bobAppId}/evil.pdf', '${ALICE}')`),
    );
  });

  it("hides one customer's files from another, but shows them to admins", async () => {
    expect(await asUser(db, BOB, "select name from storage.objects")).toHaveLength(0);
    expect(await asUser(db, ALICE, "select name from storage.objects")).toHaveLength(1);
    expect(await asUser(db, ADMIN, "select name from storage.objects")).toHaveLength(1);
  });

  it("does not let anonymous visitors touch the bucket", async () => {
    expect(await asUser(db, null, "select name from storage.objects")).toHaveLength(0);
  });
});

describe("automatic timeline", () => {
  it("writes a 'created' event when a customer submits a request", async () => {
    const rows = await asUser<{ id: string }>(
      db,
      BOB,
      `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality,
         country_of_residence, destination_country, employment_status)
       values ('${BOB}', '${serviceId}', 'Bob Timeline', 'b@example.dz', '+213555999888', 'DZ', 'DZ', 'IT', 'employed')
       returning id`,
    );
    const events = await asUser<{ kind: string }>(db, BOB, `select kind from public.application_events where application_id = '${rows[0].id}'`);
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });
});
