import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser, applyMigrationsThrough } from "./helpers";
// @ts-expect-error plain JavaScript helper shared with the manifest script
import { migrationFiles } from "../../scripts/migration-files.mjs";

/** Migration order, dependencies and the checksum manifest. Static checks read files; the chain runs on PGlite only. */

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const numbered = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

describe("migration order", () => {
  it("numbers are contiguous from 0001 and each file is unique", () => {
    const nums = numbered.map((f) => Number(f.slice(0, 4)));
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
  });

  it("0010 (append-only audit triggers) comes before 0018, and 0018 is the last migration", () => {
    const tenth = numbered.findIndex((f) => f.startsWith("0010_"));
    const eighteenth = numbered.findIndex((f) => f.startsWith("0018_"));
    expect(tenth).toBeGreaterThanOrEqual(0);
    expect(tenth).toBeLessThan(eighteenth);
    expect(numbered[numbered.length - 1]).toBe("0018_owner_approval_center.sql");
  });

  it("0018 defines no dependency on a later migration", () => {
    const sql = read("supabase/migrations/0018_owner_approval_center.sql");
    expect(sql).not.toMatch(/0019|0020/);
  });
});

describe("schema and trigger dependencies", () => {
  it("0010 relies on the append-only function that 0004 defines", () => {
    expect(read("supabase/migrations/0004_event_bus.sql")).toMatch(/create or replace function public\.ai_append_only\(\)/);
    expect(read(`supabase/migrations/${numbered.find((f) => f.startsWith("0010_"))!}`)).toMatch(/execute function public\.ai_append_only\(\)/);
  });

  it("0018 has no drop table and no drop column in the forward migration", () => {
    const sql = read("supabase/migrations/0018_owner_approval_center.sql");
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/^\s*truncate\s+/im);
  });

  it("0018 applies without 0010, and the integrity report then names the missing trigger (no silent gap)", async () => {
    const db: PGlite = await createTestDb();
    const OWNER = "00000000-0000-0000-0000-0000000000a1";
    try {
      await applyMigrationsThrough(db, "0018", ["0010"]);
      await db.exec(`
        insert into auth.users (id, email, raw_user_meta_data) values ('${OWNER}', 'owner@example.dz', '{}');
        update public.profiles set role = 'admin' where id = '${OWNER}';
      `);
      const rows = await asUser<{ check_name: string; passed: boolean }>(db, OWNER, `select check_name, passed from public.ai_audit_integrity_report()`);
      expect(rows.find((r) => r.check_name === "ai_events_append_only_trigger")?.passed).toBe(false);
      expect(rows.find((r) => r.check_name === "sources_guard_trigger")?.passed).toBe(true);
    } finally {
      await db.close();
    }
  });
});

describe("checksum manifest", () => {
  const manifest = JSON.parse(read("docs/migrations/manifest.json")) as { files: Record<string, string> };

  it("covers every migration and the rollback script", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(migrationFiles(root).slice().sort());
  });

  it("matches the files as they are: a changed migration without a regenerated manifest fails here", () => {
    for (const [name, digest] of Object.entries(manifest.files)) {
      const actual = createHash("sha256").update(readFileSync(resolve(root, name))).digest("hex");
      expect(actual, `${name}: run node scripts/migration-manifest.mjs after review`).toBe(digest);
    }
  });
});

describe("applied history is not rewritten", () => {
  it("every migration from 0001 to 0018 is in the manifest, so an edit to any of them shows up", () => {
    const manifest = JSON.parse(read("docs/migrations/manifest.json")) as { files: Record<string, string> };
    const migrations = Object.keys(manifest.files).filter((f) => f.startsWith("supabase/migrations/"));
    expect(migrations).toHaveLength(18);
    expect(migrations[0]).toBe("supabase/migrations/0001_init.sql");
    expect(migrations[17]).toBe("supabase/migrations/0018_owner_approval_center.sql");
  });
});
