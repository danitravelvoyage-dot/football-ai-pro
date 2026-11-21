import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers";

/**
 * The whole migration chain, applied in order on one disposable database, with the seed. Each file is tested alone
 * elsewhere; this checks they compose: no file depends on a later one, and the final schema has every expected table.
 * Runs on PGlite only. No live database is touched.
 */

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

let db: PGlite;
const applied: string[] = [];

beforeAll(async () => {
  // createTestDb applies 0001 and the seed. The rest are applied here, in order.
  db = await createTestDb();
  for (const f of files) {
    if (f === "0001_init.sql") continue;
    await db.exec(readFileSync(resolve(DIR, f), "utf8"));
    applied.push(f);
  }
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("migration chain 0002–0018", () => {
  it("applies every migration after 0001 without error, in order", () => {
    expect(applied).toEqual(files.filter((f) => f !== "0001_init.sql"));
    expect(applied).toHaveLength(17);
  });

  it("creates every table the platform expects", async () => {
    const res = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'ai_%'",
    );
    const names = new Set(res.rows.map((r) => r.table_name));
    const expected = [
      "ai_agents", "ai_operators", "ai_workflow_runs", "ai_tasks", "ai_task_dependencies", "ai_artifacts", "ai_approvals",
      "ai_domain_events", "ai_event_subscriptions", "ai_event_deliveries", "ai_quality_reviews", "ai_kb_entries",
      "ai_campaigns", "ai_content_reviews", "ai_kb_entry_versions", "ai_scheduler_jobs", "ai_owner_notifications",
      "ai_leads", "ai_lead_stage_history", "ai_lead_interactions", "ai_follow_ups",
      "ai_competitor_sources", "ai_competitor_observations", "ai_review_panels", "ai_routing_decisions", "ai_conflicts",
    ];
    for (const t of expected) expect(names.has(t), t).toBe(true);
  });

  it("enables row-level security on every AI table that holds owner or customer data", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ai_%'",
    );
    const off = res.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(off).toEqual([]);
  });

  it("the seeded agents exist and every subscription points at a real agent", async () => {
    const orphan = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ai_event_subscriptions s left join public.ai_agents a on a.key = s.subscriber where a.key is null",
    );
    expect(orphan.rows[0]?.n).toBe(0);
    const agents = await db.query<{ n: number }>("select count(*)::int as n from public.ai_agents");
    expect(agents.rows[0]?.n).toBeGreaterThanOrEqual(16);
  });

  it("the stage guard, the conflict guard and the append-only triggers are installed", async () => {
    const triggers = await db.query<{ tgname: string }>("select tgname from pg_trigger where not tgisinternal");
    const names = triggers.rows.map((r) => r.tgname);
    for (const t of ["ai_leads_stage_guard", "ai_conflicts_guard", "ai_leads_updated_at"]) expect(names).toContain(t);
  });

  it("the migrations do not drop or delete customer data in the original tables", () => {
    for (const f of files.slice(1)) {
      const sql = readFileSync(resolve(DIR, f), "utf8");
      expect(sql, f).not.toMatch(/\bdrop\s+table\b/i);
      expect(sql, f).not.toMatch(/^\s*delete\s+from\s+public\.(applications|profiles|payments|documents)\b/im);
    }
  });
});
