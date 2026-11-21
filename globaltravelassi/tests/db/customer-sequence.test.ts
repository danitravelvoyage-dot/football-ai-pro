import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { PGlite as PG } from "@electric-sql/pglite";

/**
 * The customer-launch sequence, the one the staging runbook applies: 0001, the base seed, then 0019 to 0023 and the
 * catalogue. The AI migrations (0002 to 0018) are NOT part of it. Proves the sequence applies in order on a fresh
 * database and that the AI tables are absent. PGlite only.
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const sequence = [
  "supabase/migrations/0001_init.sql",
  "supabase/seed.sql",
  "supabase/migrations/0019_manual_payments.sql",
  "supabase/migrations/0020_customer_hardening.sql",
  "supabase/migrations/0021_customer_email_notifications.sql",
  "supabase/migrations/0022_remove_payment_workflow.sql",
  "supabase/migrations/0023_crm_attribution_requests.sql",
  "supabase/seed_catalog.sql",
];

let db: PGlite;

beforeAll(async () => {
  db = new PG();
  await db.exec(read("tests/db/supabase-stubs.sql"));
  for (const file of sequence) await db.exec(read(file));
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("customer-launch migration sequence", () => {
  it("applies every step in order without an error", () => {
    expect(sequence).toHaveLength(8);
  });

  it("creates the customer tables, the CRM tables and the email log", async () => {
    const r = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('applications','documents','services','crm_activity','customer_email_notifications','rate_limit_hits','payments')`,
    );
    expect(r.rows.map((x) => x.table_name).sort()).toEqual(["applications", "crm_activity", "customer_email_notifications", "documents", "payments", "rate_limit_hits", "services"]);
  });

  it("has no AI table: the AI back office is not part of this launch", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'ai\\_%'`);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("has the nine business services active, and the two extra services inactive", async () => {
    const r = await db.query<{ slug: string; is_active: boolean }>(`select slug, is_active from public.services order by slug`);
    const active = r.rows.filter((x) => x.is_active).map((x) => x.slug);
    for (const slug of ["visa-consulting", "appointment-assistance", "e-visa", "transit-airport", "france-visa-appointment", "visa-file-assistance", "flight-booking", "hotel-booking", "travel-itinerary"]) {
      expect(active, slug).toContain(slug);
    }
    expect(active).not.toContain("european-trips");
    expect(active).not.toContain("travel-consultation");
  });
});
