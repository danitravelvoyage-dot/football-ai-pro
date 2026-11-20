import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;
let taskId: string;
let runId: string;

async function expectDenied(p: Promise<unknown>, message?: string) {
  if (message) await expect(p).rejects.toThrow(message);
  else await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["0002_ai_company", "0003_agent_seed", "0004_event_bus", "0008_quality_reviews"]) {
    await db.exec(readFileSync(resolve(__dirname, `../../supabase/migrations/${name}.sql`), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'),
      ('${OPERATOR}', 'runner@example.dz', '{}'),
      ('${CUSTOMER}', 'customer@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
  `);
  const [run] = await asUser<{ id: string }>(db, OPERATOR, `insert into public.ai_workflow_runs (workflow_key, objective, idempotency_key, created_by)
    values ('marketing', 'Quality test', 'quality-db-key-1', 'owner-1') returning id`);
  runId = run!.id;
  const [task] = await asUser<{ id: string }>(db, OPERATOR, `insert into public.ai_tasks (run_id, workflow_key, step_key, agent, title, input)
    values ('${runId}', 'marketing', 'research', 'MarketResearchAgent', 'Research', '{"objective":"x"}') returning id`);
  taskId = task!.id;
});

afterAll(async () => {
  await db.close();
});

const insertReview = (attempt: number, status = "NEEDS_REVISION", overall = 55) =>
  asUser(db, OPERATOR, `insert into public.ai_quality_reviews (task_id, run_id, agent, attempt, status, overall, scores, issues, feedback)
    values ('${taskId}', '${runId}', 'MarketResearchAgent', ${attempt}, '${status}', ${overall}, '{"completeness":80}', '[{"code":"unsupported_claim"}]', '[]')`);

describe("quality review storage", () => {
  it("the runner records a review, and the owner reads it", async () => {
    await insertReview(1);
    const rows = await asUser(db, ADMIN, `select attempt, status from public.ai_quality_reviews where task_id = '${taskId}'`);
    expect(rows).toEqual([{ attempt: 1, status: "NEEDS_REVISION" }]);
  });

  it("each attempt is recorded once", async () => {
    await expectDenied(insertReview(1), "duplicate key");
  });

  it("only the four agreed statuses are accepted", async () => {
    await expectDenied(insertReview(2, "MAYBE"), "check constraint");
  });

  it("the overall score must be between 0 and 100", async () => {
    await expectDenied(insertReview(2, "PASSED", 101), "check constraint");
  });

  it("reviews cannot be changed or deleted, even by the owner role", async () => {
    expect(await asUser(db, ADMIN, `update public.ai_quality_reviews set status = 'PASSED' where task_id = '${taskId}' returning id`)).toHaveLength(0);
    expect(await asUser(db, ADMIN, `delete from public.ai_quality_reviews where task_id = '${taskId}' returning id`)).toHaveLength(0);
    await expect(db.query(`update public.ai_quality_reviews set status = 'PASSED'`)).rejects.toThrow("append-only");
    await expect(db.query(`delete from public.ai_quality_reviews`)).rejects.toThrow("append-only");
  });

  it("customers and anonymous visitors see no reviews", async () => {
    expect(await asUser(db, CUSTOMER, "select id from public.ai_quality_reviews")).toHaveLength(0);
    await expectDenied(asUser(db, null, "select id from public.ai_quality_reviews"));
  });
});
