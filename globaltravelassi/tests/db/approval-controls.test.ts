import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";
import { APPROVAL_POLICY } from "@/lib/ai/approvals/policy";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;
let taskId: string;

async function expectDenied(p: Promise<unknown>, message?: string) {
  if (message) await expect(p).rejects.toThrow(message);
  else await expect(p).rejects.toThrow();
}

/** Creates a pending approval as the runner. The database sets its expiry and fingerprint. */
async function requestApproval(action = "external_send_message", preview = '{"text":"Hello"}') {
  const rows = await asUser<{ id: string; expires_at: string; payload_hash: string }>(
    db,
    OPERATOR,
    `insert into public.ai_approvals (task_id, action_class, risk_level, summary, preview, status)
     values ('${taskId}', '${action}', 'medium', 'Customer message', '${preview}'::jsonb, 'pending')
     returning id, expires_at, payload_hash`,
  );
  return rows[0]!;
}

/** Inserts a row the database normally would not accept, to simulate an approval that is already past its window. */
async function insertRaw(sql: string) {
  await db.exec("alter table public.ai_approvals disable trigger ai_approval_prepare");
  try {
    const rows = await db.query<{ id: string }>(sql);
    return rows.rows[0]!.id;
  } finally {
    await db.exec("alter table public.ai_approvals enable trigger ai_approval_prepare");
  }
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0002_ai_company.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0007_approval_controls.sql"), "utf8"));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'),
      ('${OPERATOR}', 'runner@example.dz', '{}'),
      ('${CUSTOMER}', 'customer@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_agents (key, name, prompt_version) values ('COOAgent', 'AI COO', '1.0.0');
  `);
  const [run] = await asUser<{ id: string }>(
    db,
    OPERATOR,
    `insert into public.ai_workflow_runs (workflow_key, objective, idempotency_key, created_by)
     values ('marketing', 'Test objective', 'approval-db-key-1', 'owner-1') returning id`,
  );
  const [task] = await asUser<{ id: string }>(
    db,
    OPERATOR,
    `insert into public.ai_tasks (run_id, workflow_key, step_key, agent, title, input, action_class, requires_approval)
     values ('${run!.id}', 'marketing', 'approval', 'COOAgent', 'Publish', '{"objective":"x"}', 'external_publish', true) returning id`,
  );
  taskId = task!.id;
});

afterAll(async () => {
  await db.close();
});

describe("database sets expiry and fingerprint", () => {
  it("expiry is 24 hours for a customer message, and the fingerprint is set", async () => {
    const approval = await requestApproval();
    const created = await db.query<{ hours: number }>(
      `select extract(epoch from (expires_at - created_at))::int / 3600 as hours from public.ai_approvals where id = '${approval.id}'`,
    );
    expect(created.rows[0]!.hours).toBe(24);
    expect(approval.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the database refuses an approval for an action that needs none", async () => {
    await expectDenied(requestApproval("write_draft"), "does not need owner approval");
  });

  it("the database expiry table agrees with the application policy for every class", async () => {
    for (const [action, rule] of Object.entries(APPROVAL_POLICY)) {
      const rows = await db.query<{ hours: number | null }>("select public.ai_approval_hours($1) as hours", [action]);
      expect(rows.rows[0]!.hours, action).toBe(rule.expirationHours);
    }
  });
});

describe("owner-only decisions and bound payloads", () => {
  it("the runner cannot approve", async () => {
    const approval = await requestApproval();
    await expectDenied(asUser(db, OPERATOR, `update public.ai_approvals set status = 'approved', decided_at = now() where id = '${approval.id}'`), "Only the owner");
  });

  it("the owner approves a pending item within its window", async () => {
    const approval = await requestApproval();
    const rows = await asUser<{ status: string }>(
      db,
      ADMIN,
      `update public.ai_approvals set status = 'approved', decided_by = '${ADMIN}', decided_at = now() where id = '${approval.id}' returning status`,
    );
    expect(rows[0]?.status).toBe("approved");
  });

  it("the preview cannot change after the approval is requested", async () => {
    const approval = await requestApproval();
    await expectDenied(
      asUser(db, ADMIN, `update public.ai_approvals set preview = '{"text":"Changed"}'::jsonb where id = '${approval.id}'`),
      "bound to its payload",
    );
  });

  it("an approval past its window cannot be approved", async () => {
    const id = await insertRaw(
      `insert into public.ai_approvals (task_id, action_class, risk_level, summary, preview, status, expires_at, payload_hash)
       values ('${taskId}', 'external_send_message', 'low', 'Late', '{"text":"Late"}', 'pending', now() - interval '1 hour',
               public.ai_approval_fingerprint('external_send_message', '${taskId}', '{"text":"Late"}')) returning id`,
    );
    await expectDenied(
      asUser(db, ADMIN, `update public.ai_approvals set status = 'approved', decided_by = '${ADMIN}', decided_at = now() where id = '${id}'`),
      "has expired",
    );
  });

  it("an approval whose fingerprint no longer matches cannot be approved", async () => {
    const id = await insertRaw(
      `insert into public.ai_approvals (task_id, action_class, risk_level, summary, preview, status, expires_at, payload_hash)
       values ('${taskId}', 'external_send_message', 'low', 'Forged', '{"text":"Forged"}', 'pending', now() + interval '1 hour', '${"0".repeat(64)}') returning id`,
    );
    await expectDenied(
      asUser(db, ADMIN, `update public.ai_approvals set status = 'approved', decided_by = '${ADMIN}', decided_at = now() where id = '${id}'`),
      "no longer matches its payload",
    );
  });
});

describe("expiry and the one-time execution claim", () => {
  it("the runner cannot expire an approval before its window ends", async () => {
    const approval = await requestApproval();
    await expectDenied(asUser(db, OPERATOR, `update public.ai_approvals set status = 'expired', decided_at = now() where id = '${approval.id}'`), "has not expired yet");
  });

  it("the runner expires a due approval, and the audit trail records it as the system", async () => {
    const id = await insertRaw(
      `insert into public.ai_approvals (task_id, action_class, risk_level, summary, preview, status, expires_at, payload_hash)
       values ('${taskId}', 'external_send_message', 'low', 'Due', '{"text":"Due"}', 'pending', now() - interval '5 minutes',
               public.ai_approval_fingerprint('external_send_message', '${taskId}', '{"text":"Due"}')) returning id`,
    );
    const rows = await asUser<{ status: string }>(db, OPERATOR, `update public.ai_approvals set status = 'expired', decided_at = now() where id = '${id}' returning status`);
    expect(rows[0]?.status).toBe("expired");
    const events = await db.query<{ actor: string; event_type: string }>(`select actor, event_type from public.ai_events where entity_id = '${id}'`);
    expect(events.rows).toEqual([{ actor: "system", event_type: "approval.expired" }]);
  });

  it("the owner claims execution once; the runner cannot claim it", async () => {
    const approval = await requestApproval();
    await asUser(db, ADMIN, `update public.ai_approvals set status = 'approved', decided_by = '${ADMIN}', decided_at = now() where id = '${approval.id}'`);
    await expectDenied(asUser(db, OPERATOR, `update public.ai_approvals set executed_at = now() where id = '${approval.id}'`), "already approved");
    const claimed = await asUser<{ executed_at: string }>(db, ADMIN, `update public.ai_approvals set executed_at = now() where id = '${approval.id}' returning executed_at`);
    expect(claimed).toHaveLength(1);
    await expectDenied(asUser(db, ADMIN, `update public.ai_approvals set executed_at = now() where id = '${approval.id}'`), "already approved");
  });

  it("customers see no approvals", async () => {
    expect(await asUser(db, CUSTOMER, "select id from public.ai_approvals")).toHaveLength(0);
  });
});
