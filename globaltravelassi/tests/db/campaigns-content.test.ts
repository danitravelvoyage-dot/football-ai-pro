import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/** Migration 0013 on PGlite: campaign history is append-only, reviews are admin-written, knowledge versions are kept by the database. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CAMPAIGN = "00000000-0000-0000-0000-0000000000d1";
const ARTIFACT = "00000000-0000-0000-0000-0000000000e1";
const KB = "00000000-0000-0000-0000-0000000000f1";

let db: PGlite;
const as = (userId: string | null, sql: string, params: unknown[] = []) => asUser<Record<string, unknown>>(db, userId, sql, params);

beforeAll(async () => {
  db = await createTestDb();
  for (const f of ["0002_ai_company.sql", "0006_knowledge_base.sql", "0013_campaigns_content_knowledge.sql"]) {
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_agents (key, name, prompt_version) values ('SalesAgent', 'Sales', '1.0.0');
    insert into public.ai_campaigns (id, name, goal, channel, status, created_by) values ('${CAMPAIGN}', 'Spring', 'Goal text here.', 'whatsapp', 'draft', 'owner');
    insert into public.ai_workflow_runs (id, workflow_key, objective, idempotency_key, created_by) values ('00000000-0000-0000-0000-0000000000b9', 'sales', 'Objective text.', 'run-0013-key', 'owner');
    insert into public.ai_tasks (id, run_id, workflow_key, step_key, agent, title, status, input, attempts, max_attempts, next_run_at)
      values ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000b9', 'sales', 'draft', 'SalesAgent', 'Draft', 'succeeded', '{}', 1, 3, now());
    insert into public.ai_artifacts (id, task_id, agent, kind, language, country, body, status, source) values
      ('${ARTIFACT}', '00000000-0000-0000-0000-0000000000b8', 'SalesAgent', 'caption', 'fr', 'dz', '{"text":"Hello"}', 'awaiting_owner', 'mock');
    insert into public.ai_kb_entries (id, category, slug, language, country, title, body, reliability_status, version, created_by)
      values ('${KB}', 'customer_faq', 'how-to-apply', 'fr', 'all', 'Comment postuler', 'Texte initial de la fiche.', 'unverified', 1, 'owner');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("campaign history", () => {
  it("the owner records campaign events; the operator cannot", async () => {
    await as(ADMIN, "insert into public.ai_campaign_events (campaign_id, event_type, actor) values ($1, 'created', 'owner-1')", [CAMPAIGN]);
    await expect(as(OPERATOR, "insert into public.ai_campaign_events (campaign_id, event_type, actor) values ($1, 'forged', 'runner')", [CAMPAIGN])).rejects.toThrow();
  });

  it("history cannot be edited, deleted or truncated by anyone", async () => {
    await expect(as(ADMIN, "update public.ai_campaign_events set event_type = 'changed'")).rejects.toThrow();
    await expect(as(ADMIN, "delete from public.ai_campaign_events")).rejects.toThrow();
    await expect(as(ADMIN, "truncate public.ai_campaign_events")).rejects.toThrow();
  });

  it("spend must be positive; a campaign's budget has a ceiling", async () => {
    await expect(as(ADMIN, "insert into public.ai_campaign_spend (campaign_id, amount_minor, note) values ($1, 0, 'nothing')", [CAMPAIGN])).rejects.toThrow();
    await expect(as(ADMIN, "update public.ai_campaigns set budget_minor = 99999999999999 where id = $1", [CAMPAIGN])).rejects.toThrow();
  });

  it("a campaign carries at most five KPIs", async () => {
    await expect(as(ADMIN, `update public.ai_campaigns set kpis = '[1,2,3,4,5,6]'::jsonb where id = $1`, [CAMPAIGN])).rejects.toThrow();
  });
});

describe("content review history", () => {
  it("only the owner records a review decision; the operator cannot approve content", async () => {
    await expect(as(OPERATOR, "insert into public.ai_content_reviews (artifact_id, decision, reviewer) values ($1, 'approved', 'runner')", [ARTIFACT])).rejects.toThrow();
    await as(ADMIN, "insert into public.ai_content_reviews (artifact_id, decision, reviewer, note) values ($1, 'revision_requested', 'owner-1', 'Shorter please')", [ARTIFACT]);
    const rows = await as(ADMIN, "select decision from public.ai_content_reviews where artifact_id = $1", [ARTIFACT]);
    expect(rows.map((r) => r.decision)).toEqual(["revision_requested"]);
  });

  it("reviews are append-only", async () => {
    await expect(as(ADMIN, "update public.ai_content_reviews set decision = 'approved'")).rejects.toThrow();
    await expect(as(ADMIN, "delete from public.ai_content_reviews")).rejects.toThrow();
  });
});

describe("knowledge base versions", () => {
  it("a change to an entry keeps the previous content as a version, written by the database", async () => {
    await as(ADMIN, "update public.ai_kb_entries set title = 'Comment postuler (mis à jour)', version = 2 where id = $1", [KB]);
    const versions = await as(ADMIN, "select version, title, body from public.ai_kb_entry_versions where entry_id = $1", [KB]);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, title: "Comment postuler", body: "Texte initial de la fiche." });
  });

  it("an update that changes nothing in the kept fields writes no version", async () => {
    await as(ADMIN, "update public.ai_kb_entries set updated_at = now() where id = $1", [KB]);
    const versions = await as(ADMIN, "select count(*)::int as n from public.ai_kb_entry_versions where entry_id = $1", [KB]);
    expect(versions[0]?.n).toBe(1);
  });

  it("an entry carries at most ten tags", async () => {
    const tags = `array[${Array.from({ length: 11 }, (_, i) => `'t${i}'`).join(",")}]`;
    await expect(as(ADMIN, `update public.ai_kb_entries set tags = ${tags} where id = $1`, [KB])).rejects.toThrow();
  });

  it("versions cannot be edited or deleted", async () => {
    await expect(as(ADMIN, "update public.ai_kb_entry_versions set title = 'rewritten'")).rejects.toThrow();
    await expect(as(ADMIN, "delete from public.ai_kb_entry_versions")).rejects.toThrow();
  });
});
