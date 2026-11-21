import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/** Migration 0015 on PGlite: stage guard, history written by the database, append-only records, and customer-data isolation. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const BOB = "00000000-0000-0000-0000-0000000000b2";
const LEAD = "00000000-0000-0000-0000-0000000000d1";
const LEAD_2 = "00000000-0000-0000-0000-0000000000d2";
const INTERACTION = "00000000-0000-0000-0000-0000000000e1";
const FOLLOW_UP = "00000000-0000-0000-0000-0000000000f1";

let db: PGlite;
let serviceId: string;
let applicationId: string;
const as = (userId: string | null, sql: string, params: unknown[] = []) => asUser<Record<string, unknown>>(db, userId, sql, params);

beforeAll(async () => {
  db = await createTestDb();
  for (const f of ["0002_ai_company.sql", "0015_crm_sales.sql"]) {
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}'), ('${BOB}', 'bob@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
  `);
  serviceId = (await db.query<{ id: string }>("select id from public.services where slug='visa-consulting'")).rows[0].id;
  applicationId = (
    await db.query<{ id: string }>(
      `insert into public.applications (user_id, service_id, full_name, email, whatsapp, nationality, country_of_residence, destination_country, employment_status)
       values ('${BOB}', '${serviceId}', 'Bob Two', 'b@example.dz', '+213555999888', 'DZ', 'DZ', 'FR', 'employed') returning id`,
    )
  ).rows[0].id;
  await db.exec(`
    insert into public.ai_leads (id, label, source, destination_country, created_by)
      values ('${LEAD}', 'Family visa enquiry', 'manual', 'FR', 'owner');
    insert into public.ai_leads (id, label, source, destination_country, created_by)
      values ('${LEAD_2}', 'Second enquiry', 'manual', 'DE', 'owner');
    insert into public.ai_lead_interactions (id, lead_id, kind, summary, recorded_by)
      values ('${INTERACTION}', '${LEAD}', 'note', 'Asked about dates', 'owner');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("stage guard", () => {
  it("lets the owner move a lead along a valid path, and the database writes the history row", async () => {
    await as(ADMIN, `update public.ai_leads set stage = 'contacted' where id = '${LEAD}' returning id`);
    const rows = await as(ADMIN, `select from_stage, to_stage, changed_by from public.ai_lead_stage_history where lead_id = '${LEAD}'`);
    expect(rows).toEqual([{ from_stage: "new", to_stage: "contacted", changed_by: ADMIN }]);
  });

  it("refuses a stage move the pipeline does not allow, and writes no history for it", async () => {
    await expect(as(ADMIN, `update public.ai_leads set stage = 'converted' where id = '${LEAD}'`)).rejects.toThrow(/not allowed/);
    const rows = await as(ADMIN, `select 1 from public.ai_lead_stage_history where lead_id = '${LEAD}' and to_stage = 'converted'`);
    expect(rows).toHaveLength(0);
  });

  it("refuses a lost lead without a reason", async () => {
    await expect(as(ADMIN, `update public.ai_leads set stage = 'lost' where id = '${LEAD}'`)).rejects.toThrow(/needs a reason/);
  });

  it("accepts a lost lead with a reason and records the reason in history", async () => {
    await as(ADMIN, `update public.ai_leads set stage = 'lost', stage_reason = 'Booked elsewhere' where id = '${LEAD}' returning id`);
    const rows = await as(ADMIN, `select reason from public.ai_lead_stage_history where lead_id = '${LEAD}' and to_stage = 'lost'`);
    expect(rows).toEqual([{ reason: "Booked elsewhere" }]);
  });

  it("does not allow a converted lead to move again", async () => {
    await as(ADMIN, `update public.ai_leads set stage = 'contacted' where id = '${LEAD_2}' returning id`);
    await as(ADMIN, `update public.ai_leads set stage = 'qualified' where id = '${LEAD_2}' returning id`);
    await as(ADMIN, `update public.ai_leads set stage = 'converted' where id = '${LEAD_2}' returning id`);
    await expect(as(ADMIN, `update public.ai_leads set stage = 'qualified' where id = '${LEAD_2}'`)).rejects.toThrow(/not allowed/);
  });
});

describe("source linking", () => {
  it("refuses an application lead without an application", async () => {
    await expect(
      as(ADMIN, `insert into public.ai_leads (label, source, created_by) values ('From application', 'application', 'owner')`),
    ).rejects.toThrow();
  });

  it("refuses a manual lead that points at an application", async () => {
    await expect(
      as(ADMIN, `insert into public.ai_leads (label, source, application_id, created_by) values ('Manual', 'manual', '${applicationId}', 'owner')`),
    ).rejects.toThrow();
  });

  it("accepts an application lead tied to its application", async () => {
    const rows = await as(
      ADMIN,
      `insert into public.ai_leads (label, source, application_id, created_by) values ('Bob application', 'application', '${applicationId}', 'owner') returning id`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("one open follow-up per lead", () => {
  it("refuses a second open follow-up for the same lead, and allows one after the first is dismissed", async () => {
    await as(ADMIN, `insert into public.ai_follow_ups (id, lead_id, reason, priority, due_at, created_by) values ('${FOLLOW_UP}', '${LEAD_2}', 'idle_threshold_new', 'normal', now(), 'system')`);
    await expect(
      as(ADMIN, `insert into public.ai_follow_ups (lead_id, reason, priority, due_at, created_by) values ('${LEAD_2}', 'idle_threshold_new', 'low', now(), 'system')`),
    ).rejects.toThrow();
    await as(ADMIN, `update public.ai_follow_ups set status = 'dismissed', decided_by = 'owner' where id = '${FOLLOW_UP}' returning id`);
    const again = await as(ADMIN, `insert into public.ai_follow_ups (lead_id, reason, priority, due_at, created_by) values ('${LEAD_2}', 'idle_threshold_new', 'low', now(), 'system') returning id`);
    expect(again).toHaveLength(1);
  });
});

describe("append-only records", () => {
  it("does not let the owner change or delete stage history", async () => {
    await expect(as(ADMIN, `update public.ai_lead_stage_history set reason = 'changed' where lead_id = '${LEAD}'`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, `delete from public.ai_lead_stage_history where lead_id = '${LEAD}'`)).rejects.toThrow(/permission denied/);
  });

  it("does not let the owner change or delete interactions", async () => {
    await expect(as(ADMIN, `update public.ai_lead_interactions set summary = 'edited' where id = '${INTERACTION}'`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, `delete from public.ai_lead_interactions where id = '${INTERACTION}'`)).rejects.toThrow(/permission denied/);
  });

  it("does not let anyone delete a lead", async () => {
    await expect(as(ADMIN, `delete from public.ai_leads where id = '${LEAD_2}'`)).rejects.toThrow(/permission denied/);
  });
});

describe("customer-data isolation", () => {
  it("shows the owner every lead, history row, interaction and follow-up", async () => {
    expect((await as(ADMIN, "select id from public.ai_leads")).length).toBeGreaterThanOrEqual(2);
    expect((await as(ADMIN, "select id from public.ai_lead_interactions")).length).toBe(1);
  });

  it("hides leads, history and follow-ups from the operator account", async () => {
    expect(await as(OPERATOR, "select id from public.ai_leads")).toHaveLength(0);
    expect(await as(OPERATOR, "select id from public.ai_lead_stage_history")).toHaveLength(0);
    expect(await as(OPERATOR, "select id from public.ai_follow_ups")).toHaveLength(0);
    expect(await as(OPERATOR, "select id from public.ai_lead_interactions")).toHaveLength(0);
  });

  it("hides leads from an ordinary signed-in user", async () => {
    expect(await as(BOB, "select id from public.ai_leads")).toHaveLength(0);
  });

  it("refuses every access to an anonymous visitor", async () => {
    await expect(as(null, "select id from public.ai_leads")).rejects.toThrow(/permission denied/);
    await expect(as(null, "select id from public.ai_follow_ups")).rejects.toThrow(/permission denied/);
  });

  it("refuses inserting a lead as the operator account", async () => {
    await expect(
      as(OPERATOR, `insert into public.ai_leads (label, source, created_by) values ('Runner lead', 'manual', 'runner')`),
    ).rejects.toThrow();
  });
});
