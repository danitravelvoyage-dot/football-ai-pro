import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers";
import { CANONICAL_VECTORS, CANONICAL_REFUSALS, FINGERPRINT_VECTOR } from "../fixtures/canonical-vectors";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0002_ai_company.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/0007_approval_controls.sql"), "utf8"));
});

afterAll(async () => {
  await db.close();
});

/** The database receives the same JSON the application stores: undefined is omitted, as JSON.stringify does. */
async function dbCanonical(value: unknown): Promise<string> {
  const rows = await db.query<{ c: string }>("select public.ai_canonical_json($1::jsonb) as c", [JSON.stringify(value)]);
  return rows.rows[0]!.c;
}

describe("canonical JSON contract (database side)", () => {
  for (const v of CANONICAL_VECTORS) {
    it(`the database writes the golden text: ${v.name}`, async () => {
      expect(await dbCanonical(v.value)).toBe(v.expected);
    });
  }

  for (const r of CANONICAL_REFUSALS.filter((x) => x.database)) {
    it(`the database refuses: ${r.name}`, async () => {
      await expect(dbCanonical(r.value)).rejects.toThrow();
    });
  }

  it("the database fingerprint equals the golden fingerprint", async () => {
    const rows = await db.query<{ fp: string }>(
      "select public.ai_approval_fingerprint($1, $2::uuid, $3::jsonb) as fp",
      [FINGERPRINT_VECTOR.actionClass, FINGERPRINT_VECTOR.taskId, JSON.stringify(FINGERPRINT_VECTOR.preview)],
    );
    expect(rows.rows[0]!.fp).toBe(FINGERPRINT_VECTOR.expected);
  });
});
