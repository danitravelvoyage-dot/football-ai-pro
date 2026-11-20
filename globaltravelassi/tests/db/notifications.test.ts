import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/** Migration 0012 on PGlite: owner inbox access, idempotent writes, read-once marking, and no deletes or truncates. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const CUSTOMER = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;

const as = (userId: string | null, sql: string, params: unknown[] = []) => asUser<Record<string, unknown>>(db, userId, sql, params);
const insert = (key: string) =>
  as(OPERATOR, "insert into public.ai_owner_notifications (dedupe_key, kind, severity, title, body) values ($1, 'task_failed', 'critical', 'Task failed', 'Body text')", [key]);

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0002_ai_company.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0012_owner_notifications.sql"), "utf8"));
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

describe("owner notifications", () => {
  it("the platform writes a notice once per dedupe key; a second write with the same key is refused", async () => {
    await insert("task_failed:t-1");
    await expect(insert("task_failed:t-1")).rejects.toThrow();
    const rows = await as(ADMIN, "select count(*)::int as n from public.ai_owner_notifications where dedupe_key = 'task_failed:t-1'");
    expect(rows[0]?.n).toBe(1);
  });

  it("the owner reads notices; a customer and an anonymous visitor read nothing", async () => {
    expect((await as(ADMIN, "select id from public.ai_owner_notifications")).length).toBeGreaterThan(0);
    expect(await as(CUSTOMER, "select id from public.ai_owner_notifications")).toHaveLength(0);
    await expect(as(null, "select id from public.ai_owner_notifications")).rejects.toThrow();
  });

  it("the owner marks a notice read once; the database stamps who and when, and a read cannot be undone", async () => {
    const [row] = await as(ADMIN, "select id from public.ai_owner_notifications limit 1");
    await as(ADMIN, "update public.ai_owner_notifications set read_at = null, read_by = null where id = $1", [row!.id]);
    await as(ADMIN, "update public.ai_owner_notifications set read_at = now() where id = $1", [row!.id]);
    const first = await as(ADMIN, "select read_at, read_by from public.ai_owner_notifications where id = $1", [row!.id]);
    expect(first[0]?.read_by).toBe(ADMIN);
    await as(ADMIN, "update public.ai_owner_notifications set read_at = null, read_by = null where id = $1", [row!.id]);
    const after = await as(ADMIN, "select read_at, read_by from public.ai_owner_notifications where id = $1", [row!.id]);
    expect(after[0]?.read_at).toEqual(first[0]?.read_at);
    expect(after[0]?.read_by).toBe(ADMIN);
  });

  it("the platform cannot mark notices read, and cannot rewrite their text", async () => {
    const [row] = await as(ADMIN, "select id from public.ai_owner_notifications limit 1");
    await expect(as(OPERATOR, "update public.ai_owner_notifications set read_at = now() where id = $1", [row!.id])).resolves.toEqual([]);
    const still = await as(ADMIN, "select read_by from public.ai_owner_notifications where id = $1", [row!.id]);
    expect(still[0]?.read_by).toBe(ADMIN);
    await expect(as(ADMIN, "update public.ai_owner_notifications set body = 'changed' where id = $1", [row!.id])).rejects.toThrow();
  });

  it("notices cannot be deleted or truncated by anyone", async () => {
    await expect(as(ADMIN, "delete from public.ai_owner_notifications")).rejects.toThrow();
    await expect(as(OPERATOR, "truncate public.ai_owner_notifications")).rejects.toThrow();
    const n = await as(ADMIN, "select count(*)::int as n from public.ai_owner_notifications");
    expect(n[0]?.n).toBeGreaterThan(0);
  });

  it("a notice written already read is refused", async () => {
    await expect(as(OPERATOR, "insert into public.ai_owner_notifications (dedupe_key, kind, severity, title, body, read_at) values ('pre-read', 'task_failed', 'info', 't', 'b', now())")).rejects.toThrow();
  });
});
