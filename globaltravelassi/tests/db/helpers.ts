import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

/** Creates an in-memory Postgres with Supabase-like stubs, the real migration and seed. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(resolve(root, "tests/db/supabase-stubs.sql"), "utf8"));
  await db.exec(readFileSync(resolve(root, "supabase/migrations/0001_init.sql"), "utf8"));
  await db.exec(readFileSync(resolve(root, "supabase/seed.sql"), "utf8"));
  return db;
}

/** Runs a statement as the given signed-in user (or anon) under the Supabase `authenticated` / `anon` roles. */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.exec(`set request.jwt.claim.sub = '${userId ?? ""}'`);
  try {
    const res = await db.query<T>(sql, params);
    return res.rows;
  } finally {
    await db.exec("reset role");
    await db.exec("reset request.jwt.claim.sub");
  }
}
