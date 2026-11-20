import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";

/** Every table the platform promises is append-only. */
const APPEND_ONLY = ["ai_events", "ai_domain_events", "ai_context_versions", "ai_quality_reviews", "ai_owner_decisions", "ai_experiment_results"];

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["0002_ai_company", "0003_agent_seed", "0004_event_bus", "0005_shared_context", "0008_quality_reviews", "0009_business_memory", "0010_append_only_hardening"]) {
    await db.exec(readFileSync(resolve(__dirname, `../../supabase/migrations/${name}.sql`), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_events (actor, event_type, entity_type, entity_id) values ('system', 'seed.event', 'seed', 'x');
    insert into public.ai_owner_decisions (subject_type, subject_ref, decision, reasoning, version, decided_by)
      values ('strategy', 'spring', 'approved', 'Fits.', 1, '${ADMIN}');
    insert into public.ai_domain_events (event_type, producer, target, idempotency_key) values ('task.ready', 'system', 'broadcast', 'seed-audit-0001');
    insert into public.ai_workflow_runs (workflow_key, objective, idempotency_key, created_by) values ('marketing', 'Audit seed', 'audit-seed-0001', 'owner-1');
    insert into public.ai_tasks (run_id, workflow_key, step_key, agent, title, input)
      select id, 'marketing', 'research', 'MarketResearchAgent', 'Research', '{"objective":"x"}' from public.ai_workflow_runs limit 1;
    insert into public.ai_quality_reviews (task_id, run_id, agent, attempt, status, overall, scores)
      select t.id, t.run_id, 'MarketResearchAgent', 1, 'PASSED', 90, '{}' from public.ai_tasks t limit 1;
    insert into public.ai_context_entries (scope, scope_key, context_key, value, visibility, version, updated_by)
      values ('company', 'company', 'company.goals', '{"text":"x"}', 'team', 1, 'owner-1');
    insert into public.ai_context_versions (entry_id, version, value, changed_by)
      select id, 1, '{"text":"x"}', 'owner-1' from public.ai_context_entries limit 1;
    insert into public.ai_experiments (kind, name, hypothesis, created_by) values ('content', 'Seed', 'A seeded hypothesis.', 'owner-1');
    insert into public.ai_experiment_results (experiment_id, variant, metric_key, value, sample_size, source, period, recorded_by)
      select id, 'a', 'leads', 3, 40, 'manual', '2026-11', 'owner-1' from public.ai_experiments limit 1;
  `);
});

afterAll(async () => {
  await db.close();
});

describe("append-only: row changes are blocked for everyone", () => {
  for (const table of APPEND_ONLY) {
    it(`${table}: the owner role cannot update or delete rows`, async () => {
      await expect(db.query(`update public.${table} set id = id`)).rejects.toThrow(/append-only|Table|cannot change|bound/i);
    });
  }
});

describe("append-only: TRUNCATE is not a row operation, so it needs its own check", () => {
  for (const table of APPEND_ONLY) {
    it(`${table}: an authenticated session cannot truncate it`, async () => {
      await expect(db.exec(`set role authenticated; set request.jwt.claim.sub = '${ADMIN}'; truncate public.${table}; reset role;`)).rejects.toThrow(/append-only|permission denied/);
      await db.exec("reset role; reset request.jwt.claim.sub;");
    });
  }

  it("the decision history survives an attempted truncate by the owner session", async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ADMIN}'; truncate public.ai_owner_decisions;`).catch(() => undefined);
    await db.exec("reset role; reset request.jwt.claim.sub;");
    const rows = await db.query<{ n: number }>("select count(*)::int as n from public.ai_owner_decisions");
    expect(rows.rows[0]!.n).toBe(1);
  });
});

describe("decision access", () => {
  it("the runner cannot write a decision directly, under row-level security", async () => {
    await expect(
      asUser(db, OPERATOR, `insert into public.ai_owner_decisions (subject_type, subject_ref, decision, reasoning, version, decided_by) values ('strategy', 'x', 'approved', 'x', 1, '${ADMIN}')`),
    ).rejects.toThrow();
  });
});
