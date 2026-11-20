import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { APPROVAL_POLICY } from "@/lib/ai/approvals/policy";

const DIR = resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(resolve(DIR, name), "utf8");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const ADDED = files.filter((f) => f >= "0003_");

describe("migration history", () => {
  it("is numbered in order with no gaps from 0001 to 0009", () => {
    expect(files.map((f) => f.slice(0, 4))).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"]);
  });

  it("migrations 0003 onward never drop a table, drop a column, truncate or delete data", () => {
    for (const file of ADDED) {
      const sql = read(file);
      expect(sql, file).not.toMatch(/\bdrop\s+table\b/i);
      expect(sql, file).not.toMatch(/\bdrop\s+column\b/i);
      expect(sql, file).not.toMatch(/\btruncate\b/i);
      expect(sql, file).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it("every table created by a migration from 0003 onward enables row-level security", () => {
    for (const file of ADDED) {
      const sql = read(file);
      for (const [, table] of sql.matchAll(/create table if not exists public\.([a-z_]+)/g)) {
        expect(sql, `${file} ${table}`).toContain(`alter table public.${table} enable row level security`);
      }
    }
  });

  it("the expiry table in migration 0007 matches the application policy", () => {
    const sql = read("0007_approval_controls.sql");
    const sqlHours = Object.fromEntries([...sql.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    const appHours = Object.fromEntries(
      Object.entries(APPROVAL_POLICY)
        .filter(([, rule]) => rule.expirationHours !== null)
        .map(([action, rule]) => [action, rule.expirationHours]),
    );
    expect(sqlHours).toEqual(appHours);
  });
});
