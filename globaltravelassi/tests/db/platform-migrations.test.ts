import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";
const MIGRATIONS = ["0002_ai_company", "0003_agent_seed", "0004_event_bus", "0005_shared_context", "0006_knowledge_base"];

let db: PGlite;

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of MIGRATIONS) {
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
});

afterAll(async () => {
  await db.close();
});

describe("agent seed", () => {
  it("creates one row for each of the sixteen agents", async () => {
    const rows = await db.query<{ n: number }>("select count(*)::int as n from public.ai_agents");
    expect(rows.rows[0].n).toBe(16);
  });

  it("is idempotent: running the seed again changes nothing", async () => {
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0003_agent_seed.sql"), "utf8"));
    const rows = await db.query<{ n: number }>("select count(*)::int as n from public.ai_agents");
    expect(rows.rows[0].n).toBe(16);
  });
});

describe("event bus", () => {
  it("subscriptions are seeded: the COO watches outcomes and every agent receives ready tasks", async () => {
    const coo = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ai_event_subscriptions where subscriber = 'COOAgent' and event_type = 'task.failed'",
    );
    const ready = await db.query<{ n: number }>("select count(*)::int as n from public.ai_event_subscriptions where event_type = 'task.ready'");
    expect(coo.rows[0].n).toBe(1);
    expect(ready.rows[0].n).toBe(16);
  });

  it("customers and anonymous visitors see no events", async () => {
    await db.exec(`insert into public.ai_domain_events (event_type, producer, target, idempotency_key)
      values ('task.succeeded', 'system', 'broadcast', 'seed-event-0001')`);
    expect(await asUser(db, CUSTOMER, "select id from public.ai_domain_events")).toHaveLength(0);
    await expectDenied(asUser(db, null, "select id from public.ai_domain_events"));
  });

  it("the runner can record and read events, and the owner can read them", async () => {
    await asUser(db, OPERATOR, `insert into public.ai_domain_events (event_type, producer, target, idempotency_key, payload)
      values ('task.ready', 'COOAgent', 'SalesAgent', 'run-event-0001', '{"taskId":"t1"}')`);
    expect((await asUser(db, OPERATOR, "select id from public.ai_domain_events where idempotency_key = 'run-event-0001'")).length).toBe(1);
    expect((await asUser(db, ADMIN, "select id from public.ai_domain_events where idempotency_key = 'run-event-0001'")).length).toBe(1);
  });

  it("events cannot be updated or deleted", async () => {
    const updated = await asUser(db, ADMIN, "update public.ai_domain_events set producer = 'forged' returning id");
    const deleted = await asUser(db, ADMIN, "delete from public.ai_domain_events returning id");
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("an idempotency key cannot be used twice", async () => {
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_domain_events (event_type, producer, target, idempotency_key)
        values ('task.ready', 'COOAgent', 'SalesAgent', 'run-event-0001')`),
    );
  });

  it("rejects malformed event types, oversized payloads and oversized hop counts", async () => {
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_domain_events (event_type, producer, target, idempotency_key)
        values ('Task Ready', 'COOAgent', 'SalesAgent', 'bad-event-0001')`),
    );
    const big = "x".repeat(9000);
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_domain_events (event_type, producer, target, idempotency_key, payload)
        values ('task.ready', 'COOAgent', 'SalesAgent', 'big-event-0001', '{"blob":"${big}"}')`),
    );
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_domain_events (event_type, producer, target, idempotency_key, hop_count)
        values ('agent.handoff', 'SalesAgent', 'CRMAgent', 'hop-event-0001', 6)`),
    );
  });

  it("only the owner can change subscriptions", async () => {
    await expectDenied(
      asUser(db, OPERATOR, "insert into public.ai_event_subscriptions (subscriber, event_type) values ('SalesAgent', 'task.failed')"),
    );
    const added = await asUser(db, ADMIN, "insert into public.ai_event_subscriptions (subscriber, event_type) values ('SalesAgent', 'task.failed') returning subscriber");
    expect(added).toHaveLength(1);
  });

  it("a recipient gets one delivery per event, and a finished delivery cannot change again", async () => {
    const [event] = await asUser<{ id: string }>(db, OPERATOR, `select id from public.ai_domain_events where idempotency_key = 'run-event-0001'`);
    await asUser(db, OPERATOR, `insert into public.ai_event_deliveries (event_id, subscriber) values ('${event.id}', 'SalesAgent')`);
    await expectDenied(asUser(db, OPERATOR, `insert into public.ai_event_deliveries (event_id, subscriber) values ('${event.id}', 'SalesAgent')`));

    const delivered = await asUser<{ id: string }>(
      db,
      OPERATOR,
      `update public.ai_event_deliveries set status = 'delivered', delivered_at = now(), attempts = 1
       where event_id = '${event.id}' and subscriber = 'SalesAgent' returning id`,
    );
    expect(delivered).toHaveLength(1);
    await expectDenied(
      asUser(db, OPERATOR, `update public.ai_event_deliveries set status = 'pending', delivered_at = null where event_id = '${event.id}'`),
    );
  });

  it("a delivery must have delivered_at exactly when it is delivered", async () => {
    const [event] = await asUser<{ id: string }>(db, OPERATOR, `select id from public.ai_domain_events where idempotency_key = 'run-event-0001'`);
    await expectDenied(
      asUser(db, OPERATOR, `insert into public.ai_event_deliveries (event_id, subscriber, status) values ('${event.id}', 'CRMAgent', 'delivered')`),
    );
  });
});

describe("shared context", () => {
  const write = (scope: string, scopeKey: string, key: string, value: string, expected: number, visibility: string, who: string) =>
    `select * from public.ai_context_write('${scope}', '${scopeKey}', '${key}', '${value}'::jsonb, ${expected}, '${visibility}', '${who}', 'test')`;

  it("creates version 1, then increments on each write with the expected version", async () => {
    const created = await asUser<{ out_version: number }>(db, ADMIN, write("company", "company", "company.positioning", '{"text":"v1"}', 0, "team", "runner"));
    expect(created[0].out_version).toBe(1);
    const next = await asUser<{ out_version: number }>(db, ADMIN, write("company", "company", "company.positioning", '{"text":"v2"}', 1, "team", "runner"));
    expect(next[0].out_version).toBe(2);
  });

  it("a stale write is refused with a version conflict and changes nothing", async () => {
    await expectDenied(asUser(db, ADMIN, write("company", "company", "company.positioning", '{"text":"stale"}', 1, "team", "runner")));
    const [row] = await asUser<{ version: number }>(db, ADMIN, "select version from public.ai_context_entries where context_key = 'company.positioning'");
    expect(row.version).toBe(2);
  });

  it("every write leaves an immutable history row", async () => {
    const history = await asUser<{ version: number }>(db, ADMIN, "select version from public.ai_context_versions order by version");
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    // Row-level security hides the rows from an update or delete, so nothing changes.
    expect(await asUser(db, ADMIN, "update public.ai_context_versions set reason = 'forged' where version = 1 returning id")).toHaveLength(0);
    expect(await asUser(db, ADMIN, "delete from public.ai_context_versions where version = 1 returning id")).toHaveLength(0);
    // The trigger also blocks the database owner role, which bypasses row-level security.
    await expect(db.query("update public.ai_context_versions set reason = 'forged' where version = 1")).rejects.toThrow("append-only");
    await expect(db.query("delete from public.ai_context_versions where version = 1")).rejects.toThrow("append-only");
  });

  it("event rows are protected from the owner role as well", async () => {
    await expect(db.query("update public.ai_domain_events set producer = 'forged'")).rejects.toThrow("append-only");
    await expect(db.query("delete from public.ai_domain_events")).rejects.toThrow("append-only");
  });

  it("owner-only context is hidden from the runner; team context is visible to it", async () => {
    await asUser(db, ADMIN, write("agent", "SalesAgent", "agent.sales.notes", '{"text":"private"}', 0, "owner", "owner-1"));
    await asUser(db, ADMIN, write("workflow", "run-1", "workflow.brief", '{"text":"shared"}', 0, "team", "owner-1"));
    expect(await asUser(db, OPERATOR, "select context_key from public.ai_context_entries where context_key = 'agent.sales.notes'")).toHaveLength(0);
    expect(await asUser(db, OPERATOR, "select context_key from public.ai_context_entries where context_key = 'workflow.brief'")).toHaveLength(1);
    expect(await asUser(db, ADMIN, "select context_key from public.ai_context_entries where context_key = 'agent.sales.notes'")).toHaveLength(1);
  });

  it("customers cannot read or write context", async () => {
    expect(await asUser(db, CUSTOMER, "select id from public.ai_context_entries")).toHaveLength(0);
    await expectDenied(asUser(db, CUSTOMER, write("company", "company", "company.other", '{"text":"x"}', 0, "team", "customer")));
  });

  it("the runner cannot write company context, and cannot hide agent context from the team", async () => {
    await expectDenied(asUser(db, OPERATOR, write("company", "company", "company.runner_edit", '{"text":"x"}', 0, "team", "runner")));
    await expectDenied(asUser(db, OPERATOR, write("agent", "SalesAgent", "agent.sales.hidden", '{"text":"x"}', 0, "owner", "runner")));
    const allowed = await asUser<{ out_version: number }>(db, OPERATOR, write("agent", "SalesAgent", "agent.sales.visible", '{"text":"x"}', 0, "team", "runner"));
    expect(allowed[0].out_version).toBe(1);
    const owner = await asUser<{ out_version: number }>(db, ADMIN, write("company", "company", "company.owner_only_edit", '{"text":"x"}', 0, "owner", "owner-1"));
    expect(owner[0].out_version).toBe(1);
  });

  it("a company-scoped entry must use the company scope key", async () => {
    await expectDenied(asUser(db, ADMIN, write("company", "agent-x", "company.bad", '{"text":"x"}', 0, "team", "owner-1")));
  });
});

describe("knowledge base", () => {
  const insert = (fields: string) => `insert into public.ai_kb_entries (category, slug, language, country, title, body, official_source_url, verified_at, reliability_status, created_by)
    values ${fields}`;

  it("a visa or country fact must cite an official source, even while unverified", async () => {
    await expectDenied(
      asUser(db, ADMIN, insert(`('visa_requirements', 'fr-visa-dz', 'fr', 'dz', 'Visa France', 'Exigences à confirmer.', null, null, 'unverified', 'owner-1')`)),
    );
  });

  it("verified_official needs an https source URL and a verification timestamp", async () => {
    await expectDenied(
      asUser(db, ADMIN, insert(`('country_information', 'dz-docs', 'fr', 'dz', 'Documents', 'Liste à vérifier avec la source.', 'https://example.gov/docs', null, 'verified_official', 'owner-1')`)),
    );
    await expectDenied(
      asUser(db, ADMIN, insert(`('country_information', 'dz-docs', 'fr', 'dz', 'Documents', 'Liste à vérifier avec la source.', 'http://example.gov/docs', now(), 'verified_official', 'owner-1')`)),
    );
  });

  it("the owner can record a verified entry; the runner can read it and cannot write", async () => {
    await asUser(db, ADMIN, insert(`('country_information', 'dz-docs', 'fr', 'dz', 'Documents', 'Liste à vérifier avec la source.', 'https://example.gov/docs', now(), 'verified_official', 'owner-1')`));
    expect(await asUser(db, OPERATOR, "select slug from public.ai_kb_entries")).toHaveLength(1);
    await expectDenied(asUser(db, OPERATOR, insert(`('customer_faq', 'faq-1', 'fr', 'all', 'Question', 'Réponse de test à relire.', null, null, 'unverified', 'runner')`)));
  });

  it("customers see no knowledge entries", async () => {
    expect(await asUser(db, CUSTOMER, "select slug from public.ai_kb_entries")).toHaveLength(0);
  });

  it("entries are never deleted", async () => {
    const deleted = await asUser(db, ADMIN, "delete from public.ai_kb_entries returning id");
    expect(deleted).toHaveLength(0);
  });
});
