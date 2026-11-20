import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;
let experimentId: string;

async function expectDenied(p: Promise<unknown>, message?: string) {
  if (message) await expect(p).rejects.toThrow(message);
  else await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["0002_ai_company", "0003_agent_seed", "0004_event_bus", "0009_business_memory"]) {
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
  const [exp] = await asUser<{ id: string }>(db, OPERATOR, `insert into public.ai_experiments (kind, name, hypothesis, created_by)
    values ('content', 'Hooks', 'A question hook works better.', 'owner-1') returning id`);
  experimentId = exp!.id;
});

afterAll(async () => {
  await db.close();
});

const decide = (version: number, supersedes: string | null, user = ADMIN) =>
  asUser<{ id: string }>(db, user, `insert into public.ai_owner_decisions (subject_type, subject_ref, decision, reasoning, version, supersedes_id, decided_by)
    values ('strategy', 'spring', 'approved', 'Fits the goal.', ${version}, ${supersedes ? `'${supersedes}'` : "null"}, '${ADMIN}') returning id`);

describe("owner decisions", () => {
  it("the owner records version 1; the runner cannot record a decision", async () => {
    const [first] = await decide(1, null);
    expect(first?.id).toBeDefined();
    await expectDenied(decide(2, first!.id, OPERATOR), "row-level security");
  });

  it("a later version must point to the version it replaces", async () => {
    await expectDenied(decide(2, null), "check constraint");
  });

  it("a decision cannot be changed or deleted, even by the owner role", async () => {
    await expect(db.query("update public.ai_owner_decisions set reasoning = 'changed later'")).rejects.toThrow("append-only");
    await expect(db.query("delete from public.ai_owner_decisions")).rejects.toThrow("append-only");
  });

  it("the runner can read decisions, customers cannot", async () => {
    expect((await asUser(db, OPERATOR, "select id from public.ai_owner_decisions")).length).toBeGreaterThan(0);
    expect(await asUser(db, CUSTOMER, "select id from public.ai_owner_decisions")).toHaveLength(0);
  });
});

describe("experiment results", () => {
  const result = (extra: string, sample: number, value: number, metric = "leads") =>
    asUser(db, OPERATOR, `insert into public.ai_experiment_results (experiment_id, variant, metric_key, value, sample_size, source, period, recorded_by)
      values ('${experimentId}', 'question', '${metric}', ${value}, ${sample}, 'manual', '2026-11', 'runner') returning id${extra}`);

  it("a result with a sample is recorded", async () => {
    expect(await result("", 40, 3)).toHaveLength(1);
  });

  it("a result with no sample is refused", async () => {
    await expectDenied(result("", 0, 3), "check constraint");
  });

  it("a whole count cannot be fractional, and a reply rate cannot exceed 1", async () => {
    await expectDenied(result("", 40, 2.5, "leads"), "check constraint");
    await expectDenied(result("", 40, 1.4, "reply_rate"), "check constraint");
  });

  it("results cannot be changed or deleted", async () => {
    await expect(db.query("update public.ai_experiment_results set value = 999")).rejects.toThrow("append-only");
    await expect(db.query("delete from public.ai_experiment_results")).rejects.toThrow("append-only");
  });

  it("customers and anonymous visitors see no results", async () => {
    expect(await asUser(db, CUSTOMER, "select id from public.ai_experiment_results")).toHaveLength(0);
    await expectDenied(asUser(db, null, "select id from public.ai_experiments"));
  });
});
