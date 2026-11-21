import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { APPROVAL_POLICY } from "@/lib/ai/approvals/policy";

const DIR = resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(resolve(DIR, name), "utf8");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const ADDED = files.filter((f) => f >= "0003_");

/** The SQL outside every dollar-quoted function body. Function bodies run only when called, not when a migration applies. */
function stripFunctionBodies(sql: string): string {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
}

/** Names of functions whose body contains a delete statement. */
function functionsWithDelete(sql: string): string[] {
  const names: string[] = [];
  for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_]+)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
    if (/\bdelete\s+from\b/i.test(m[2]!)) names.push(m[1]!);
  }
  return names;
}

describe("migration history", () => {
  it("is numbered in order with no gaps from 0001 to 0021", () => {
    expect(files.map((f) => f.slice(0, 4))).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021"]);
  });

  it("migrations 0003 onward never drop a table, drop a column, truncate or delete data", () => {
    for (const file of ADDED) {
      const sql = read(file);
      expect(sql, file).not.toMatch(/\bdrop\s+table\b/i);
      expect(sql, file).not.toMatch(/\bdrop\s+column\b/i);
      // A statement that truncates data. Triggers and revokes that mention TRUNCATE are allowed.
      expect(sql, file).not.toMatch(/^\s*truncate\s+(table\s+)?[a-z_]/im);
      // A delete statement that runs when the migration is applied. Statements inside a function body run only when
      // the owner calls the function; they are listed in the allowlist test below.
      expect(stripFunctionBodies(sql), file).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it("the only delete statements inside migration functions are the owner's listed functions", () => {
    const allowed = new Set(["0019_manual_payments.sql:delete_application_request"]);
    for (const file of ADDED) {
      for (const fn of functionsWithDelete(read(file))) {
        expect(allowed.has(`${file}:${fn}`), `${file}: function ${fn} deletes data`).toBe(true);
      }
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
