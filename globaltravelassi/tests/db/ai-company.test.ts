import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";
const AGENT_ROW = "COOAgent";

let db: PGlite;
let runId: string;
let taskId: string;
let approvalId: string;

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0002_ai_company.sql"), "utf8"));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'),
      ('${OPERATOR}', 'runner@example.dz', '{}'),
      ('${CUSTOMER}', 'customer@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_agents (key, name, prompt_version) values ('${AGENT_ROW}', 'AI COO', '1.0.0');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("AI company migration is additive", () => {
  it("creates every new table with row-level security enabled", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'ai\\_%' and c.relkind = 'r'`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(15);
    for (const r of rows.rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("did not add columns to the existing customer tables", async () => {
    const rows = await db.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name in ('applications','payments','profiles','documents')
        and column_name like 'ai\\_%'`);
    expect(rows.rows).toHaveLength(0);
  });
});

describe("access by role", () => {
  it("a customer cannot see or create any AI work", async () => {
    expect(await asUser(db, CUSTOMER, "select id from public.ai_tasks")).toHaveLength(0);
    expect(await asUser(db, CUSTOMER, "select id from public.ai_events")).toHaveLength(0);
    await expectDenied(
      asUser(db, CUSTOMER, `insert into public.ai_workflow_runs (workflow_key, objective, idempotency_key, created_by)
        values ('marketing','x y z','cust-key-00001','c')`),
    );
  });

  it("anonymous visitors are refused at the table level", async () => {
    await expectDenied(asUser(db, null, "select id from public.ai_tasks"));
  });

  it("the runner can create a run and its tasks", async () => {
    const run = await asUser<{ id: string }>(
      db,
      OPERATOR,
      `insert into public.ai_workflow_runs (workflow_key, objective, idempotency_key, created_by)
       values ('sales','Follow up on leads','runner-key-0001','owner-1') returning id`,
    );
    runId = run[0]!.id;
    const task = await asUser<{ id: string }>(
      db,
      OPERATOR,
      `insert into public.ai_tasks (run_id, workflow_key, step_key, agent, title, status, input, action_class, requires_approval)
       values ('${runId}', 'sales', 'approval', '${AGENT_ROW}', 'Customer message', 'waiting_approval', '{}',
               'external_send_message', true) returning id`,
    );
    taskId = task[0]!.id;
    expect(taskId).toBeTruthy();
  });

  it("the runner can request an approval, but only as pending", async () => {
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_approvals (task_id, action_class, risk_level, summary, status, decided_at)
        values ('${taskId}', 'external_send_message', 'low', 'pre-approved', 'approved', now())`),
    );
    const rows = await asUser<{ id: string }>(
      db,
      OPERATOR,
      `insert into public.ai_approvals (task_id, action_class, risk_level, summary)
       values ('${taskId}', 'external_send_message', 'low', 'Send a follow-up') returning id`,
    );
    approvalId = rows[0]!.id;
  });

  it("the runner cannot decide an approval", async () => {
    const updated = await asUser(db, OPERATOR, `update public.ai_approvals set status = 'approved', decided_at = now() where id = '${approvalId}' returning id`);
    expect(updated).toHaveLength(0);
    const still = await db.query<{ status: string }>(`select status from public.ai_approvals where id = '${approvalId}'`);
    expect(still.rows[0]?.status).toBe("pending");
  });

  it("the owner decides, and the database writes the audit event itself", async () => {
    const rows = await asUser<{ status: string }>(
      db,
      ADMIN,
      `update public.ai_approvals set status = 'approved', decided_by = '${ADMIN}', decided_at = now() where id = '${approvalId}' returning status`,
    );
    expect(rows[0]?.status).toBe("approved");
    const events = await db.query<{ event_type: string; actor: string }>(
      `select event_type, actor from public.ai_events where entity_id = '${approvalId}'`,
    );
    expect(events.rows).toEqual([{ event_type: "approval.approved", actor: `owner:${ADMIN}` }]);
  });

  it("a decided approval can never be changed again", async () => {
    await expectDenied(
      asUser(db, ADMIN, `update public.ai_approvals set status = 'rejected', decided_by = '${ADMIN}', decided_at = now() where id = '${approvalId}'`),
    );
  });

  it("audit events are append-only: no update and no delete", async () => {
    const updated = await asUser(db, ADMIN, `update public.ai_events set actor = 'forged' returning id`);
    expect(updated).toHaveLength(0);
    const deleted = await asUser(db, ADMIN, `delete from public.ai_events returning id`);
    expect(deleted).toHaveLength(0);
    const count = await db.query<{ n: number }>(`select count(*)::int n from public.ai_events`);
    expect(count.rows[0]?.n).toBeGreaterThan(0);
  });
});

describe("queue claim and aggregates", () => {
  it("only the runner or the owner can claim work, and claims are atomic", async () => {
    await db.exec(`update public.ai_tasks set status = 'ready', next_run_at = now() - interval '1 minute' where id = '${taskId}'`);
    await expectDenied(asUser(db, CUSTOMER, "select id from public.ai_claim_ready_tasks(5)"));
    const claimed = await asUser<{ id: string; status: string; attempts: number }>(db, OPERATOR, "select id, status, attempts from public.ai_claim_ready_tasks(5)");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe("running");
    expect(claimed[0]?.attempts).toBe(1);
    const again = await asUser(db, ADMIN, "select id from public.ai_claim_ready_tasks(5)");
    expect(again).toHaveLength(0);
  });

  it("aggregate functions return counts only, with no personal columns", async () => {
    expect(await asUser(db, CUSTOMER, "select * from public.ai_requests_daily()")).toHaveLength(0);
    const rows = await asUser<Record<string, unknown>>(db, OPERATOR, "select * from public.ai_requests_daily()");
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["count", "day", "service_id", "source", "status"]);
    }
    const payments = await asUser<Record<string, unknown>>(db, ADMIN, "select * from public.ai_payments_daily()");
    for (const r of payments) {
      expect(Object.keys(r)).not.toContain("note");
      expect(Object.keys(r)).not.toContain("reference");
    }
  });

  it("the operator list is visible to the owner only", async () => {
    expect(await asUser(db, OPERATOR, "select user_id from public.ai_operators")).toHaveLength(0);
    expect((await asUser(db, ADMIN, "select user_id from public.ai_operators")).length).toBe(1);
  });
});
