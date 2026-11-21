import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/** Migration 0017 on PGlite: panels, routing and conflicts. Operator records; only the owner resolves, once. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const BOB = "00000000-0000-0000-0000-0000000000b2";
const RUN = "00000000-0000-0000-0000-0000000000b9";
const TASK = "00000000-0000-0000-0000-0000000000b8";
const CONFLICT = "00000000-0000-0000-0000-0000000000f1";
const PANEL = "00000000-0000-0000-0000-0000000000e1";

let db: PGlite;
const as = (userId: string | null, sql: string, params: unknown[] = []) => asUser<Record<string, unknown>>(db, userId, sql, params);

beforeAll(async () => {
  db = await createTestDb();
  for (const f of ["0002_ai_company.sql", "0003_agent_seed.sql", "0004_event_bus.sql", "0017_collaboration.sql"]) {
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}'), ('${BOB}', 'bob@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_workflow_runs (id, workflow_key, objective, idempotency_key, created_by) values ('${RUN}', 'sales', 'Objective text.', 'run-0017-key', 'owner');
    insert into public.ai_tasks (id, run_id, workflow_key, step_key, agent, title, status, input, attempts, max_attempts, next_run_at)
      values ('${TASK}', '${RUN}', 'sales', 'qualification', 'SalesAgent', 'Qualify', 'running', '{}', 1, 3, now());
    insert into public.ai_conflicts (id, run_id, task_id, subject_key, parties, codes)
      values ('${CONFLICT}', '${RUN}', '${TASK}', 'findings[0].insight', array['SalesAgent','CRMAgent'], array['conflicting_claims']);
  `);
});

afterAll(async () => {
  await db.close();
});

describe("review panels", () => {
  const panel = (attempt: number) => `insert into public.ai_review_panels
      (id, task_id, run_id, producer, attempt, status, decision, votes, counted, excluded, reasons, disagreement)
    values (gen_random_uuid(), '${TASK}', '${RUN}', 'SalesAgent', ${attempt}, 'PASSED', 'approve',
      '[{"reviewer":"QualityController","verdict":"approve","codes":[]}]', array['QualityController'], '[]', array['all_approve'], false)`;

  it("lets the operator record a panel", async () => {
    await as(OPERATOR, panel(1));
    const rows = await as(OPERATOR, "select decision from public.ai_review_panels where attempt = 1");
    expect(rows).toEqual([{ decision: "approve" }]);
  });

  it("keeps one panel per task attempt", async () => {
    await expect(as(OPERATOR, panel(1))).rejects.toThrow();
  });

  it("refuses more than five votes in one panel", async () => {
    const votes = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ reviewer: `R${i}`, verdict: "approve", codes: [] })));
    await expect(
      as(OPERATOR, `insert into public.ai_review_panels (id, task_id, run_id, producer, attempt, status, decision, votes, disagreement)
        values (gen_random_uuid(), '${TASK}', '${RUN}', 'SalesAgent', 9, 'PASSED', 'approve', '${votes}', false)`),
    ).rejects.toThrow();
  });

  it("does not let anyone change or delete a panel", async () => {
    await expect(as(ADMIN, `update public.ai_review_panels set decision = 'reject' where attempt = 1`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, `delete from public.ai_review_panels where attempt = 1`)).rejects.toThrow(/permission denied/);
  });
});

describe("routing decisions", () => {
  it("lets the operator record a routing decision, and nobody change it", async () => {
    await as(
      OPERATOR,
      `insert into public.ai_routing_decisions (run_id, task_id, step_key, capability, template_agent, chosen_agent, reasons, candidates)
       values ('${RUN}', '${TASK}', 'qualification', 'sales_qualification', 'SalesAgent', 'CRMAgent', array['capability_match'], 2)`,
    );
    expect(await as(OPERATOR, "select chosen_agent from public.ai_routing_decisions")).toEqual([{ chosen_agent: "CRMAgent" }]);
    await expect(as(ADMIN, "update public.ai_routing_decisions set chosen_agent = 'SalesAgent'")).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, "delete from public.ai_routing_decisions")).rejects.toThrow(/permission denied/);
  });

  it("refuses an unknown agent in a routing decision", async () => {
    await expect(
      as(OPERATOR, `insert into public.ai_routing_decisions (run_id, task_id, step_key, capability, template_agent, chosen_agent, candidates)
        values ('${RUN}', '${TASK}', 'x', 'strategy', 'SalesAgent', 'NoSuchAgent', 1)`),
    ).rejects.toThrow();
  });
});

describe("conflicts", () => {
  it("keeps one conflict per run and subject: a second record is ignored, not duplicated", async () => {
    const rows = await as(
      OPERATOR,
      `insert into public.ai_conflicts (run_id, task_id, subject_key, parties, codes) values ('${RUN}', '${TASK}', 'findings[0].insight', array['SalesAgent','CRMAgent'], array['conflicting_claims'])
       on conflict (run_id, subject_key) do nothing returning id`,
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a conflict with fewer than two parties", async () => {
    await expect(
      as(OPERATOR, `insert into public.ai_conflicts (run_id, subject_key, parties) values ('${RUN}', 'other', array['SalesAgent'])`),
    ).rejects.toThrow();
  });

  it("lets the operator record a conflict but never resolve it", async () => {
    await expect(
      as(OPERATOR, `update public.ai_conflicts set status = 'resolved', resolution = 'Use the official figure.', resolved_by = 'runner', resolved_at = now() where id = '${CONFLICT}'`),
    ).resolves.toEqual([]);
    const still = await as(ADMIN, `select status from public.ai_conflicts where id = '${CONFLICT}'`);
    expect(still).toEqual([{ status: "open" }]);
  });

  it("lets the owner resolve an open conflict with a recorded resolution", async () => {
    const rows = await as(
      ADMIN,
      `update public.ai_conflicts set status = 'resolved', resolution = 'Use the official figure from the source.', resolved_by = '${ADMIN}', resolved_at = now()
       where id = '${CONFLICT}' returning status, resolved_by`,
    );
    expect(rows).toEqual([{ status: "resolved", resolved_by: ADMIN }]);
  });

  it("does not let a resolved conflict change again, even for the owner", async () => {
    await expect(as(ADMIN, `update public.ai_conflicts set resolution = 'Changed later.' where id = '${CONFLICT}'`)).rejects.toThrow(/resolved conflict cannot change/);
  });

  it("refuses to mark a conflict resolved without a resolution, the resolver and the time", async () => {
    await as(OPERATOR, `insert into public.ai_conflicts (id, run_id, subject_key, parties) values ('00000000-0000-0000-0000-0000000000f2', '${RUN}', 'second', array['SalesAgent','CRMAgent'])`);
    await expect(as(ADMIN, `update public.ai_conflicts set status = 'resolved' where id = '00000000-0000-0000-0000-0000000000f2'`)).rejects.toThrow();
  });

  it("does not let the owner change which claims a conflict is about", async () => {
    await expect(
      as(ADMIN, `update public.ai_conflicts set subject_key = 'rewritten', status = 'resolved', resolution = 'x resolved', resolved_by = 'a', resolved_at = now() where id = '00000000-0000-0000-0000-0000000000f2'`),
    ).rejects.toThrow();
  });

  it("does not let anyone delete a conflict", async () => {
    await expect(as(ADMIN, `delete from public.ai_conflicts where id = '${CONFLICT}'`)).rejects.toThrow(/permission denied/);
  });
});

describe("isolation and subscriptions", () => {
  it("hides panels, routing and conflicts from ordinary users and anonymous visitors", async () => {
    expect(await as(BOB, "select id from public.ai_conflicts")).toHaveLength(0);
    expect(await as(BOB, "select id from public.ai_review_panels")).toHaveLength(0);
    await expect(as(null, "select id from public.ai_conflicts")).rejects.toThrow(/permission denied/);
  });

  it("subscribes every agent to questions and answers addressed to it", async () => {
    const rows = await as(
      ADMIN,
      "select count(*)::int as n from public.ai_event_subscriptions where event_type in ('agent.question','agent.answer')",
    );
    expect(Number((rows[0] as { n: number }).n)).toBeGreaterThanOrEqual(4);
  });
});

export { PANEL };
