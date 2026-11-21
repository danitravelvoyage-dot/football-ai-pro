import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, applyMigrationsThrough } from "./helpers";

/**
 * Rollback of migration 0018, run on a disposable PGlite database. The forward migration is applied, data is seeded,
 * the fingerprints are taken as the backup procedure describes, the rollback runs, and the archives are checked.
 */

const load = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const LEAD = "00000000-0000-0000-0000-0000000000e1";
const REASON = "Confirmed against the official page";

let db: PGlite;

const FINGERPRINT = `
  select 'review' as t, count(*)::int as n, md5(coalesce(string_agg(id::text || ':' || status || ':' || version::text, ',' order by id), '')) as f from public.ai_review_items
  union all
  select 'sources', count(*)::int, md5(coalesce(string_agg(host || ':' || status || ':' || version::text, ',' order by host), '')) from public.ai_sources_allowlist
  union all
  select 'audit', count(*)::int, md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.ai_events
`;

/** The audit history on its own: it is the one part that must be identical before and after the rollback. */
async function auditFingerprint(d: PGlite = db) {
  const r = await d.query<{ n: number; f: string }>(`select count(*)::int as n, md5(coalesce(string_agg(id::text, ',' order by id), '')) as f from public.ai_events`);
  return r.rows[0]!;
}

async function fingerprints(d: PGlite = db) {
  const r = await d.query<{ t: string; n: number; f: string }>(FINGERPRINT);
  return Object.fromEntries(r.rows.map((x) => [x.t, { n: x.n, f: x.f }]));
}

beforeAll(async () => {
  db = await createTestDb();
  await applyMigrationsThrough(db, "0018");
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'owner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_leads (id, label, source, interest, stage, created_by) values ('${LEAD}', 'Enquiry', 'manual', 'visa', 'new', 'owner-1');
    update public.ai_leads set label = 'Renamed' where id = '${LEAD}';
    insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at, status, decided_by, decided_at, decision_reason, version)
      values ('00000000-0000-0000-0000-0000000000d1', 'crm_transition', 'lead-1', 'Move', now() + interval '7 days', 'approved', '${ADMIN}', now(), 'Checked', 2);
    insert into public.ai_review_items (id, kind, subject_ref, summary, expires_at)
      values ('00000000-0000-0000-0000-0000000000d2', 'held_answer', 'q-2', 'Held', now() + interval '7 days');
    insert into public.ai_sources_allowlist (host, purpose, approved_by, last_change_reason) values ('visa.example.gov.dz', 'Visa rules', '${ADMIN}', 'Added by the owner');
    update public.ai_sources_allowlist set purpose = 'Visa rules v2', last_change_reason = '${REASON}' where host = 'visa.example.gov.dz';
  `);
});

afterAll(async () => {
  await db.close();
});

describe("rollback of 0018", () => {
  let before: Awaited<ReturnType<typeof fingerprints>>;
  let auditBefore: { n: number; f: string };

  it("is refused without the explicit confirmation, and changes nothing", async () => {
    before = await fingerprints();
    auditBefore = await auditFingerprint();
    await expect(db.exec(load("docs/migrations/0018_rollback.sql"))).rejects.toThrow(/Rollback refused: set gta.rollback_confirmed/);
    await db.exec("rollback");
    expect(await fingerprints()).toEqual(before);
  });

  it("is refused when an archive from an earlier rollback exists, and keeps the live data", async () => {
    await db.exec(`create table public.ai_review_items_archive as select * from public.ai_review_items where false`);
    await db.exec(`set gta.rollback_confirmed = 'yes'`);
    await expect(db.exec(load("docs/migrations/0018_rollback.sql"))).rejects.toThrow(/archive from an earlier rollback exists/);
    await db.exec("rollback");
    await db.exec(`drop table public.ai_review_items_archive`);
    expect(await fingerprints()).toEqual(before);
  });

  it("with confirmation, archives every row, verifies the copies, and removes only the 0018 objects", async () => {
    await db.exec(`set gta.rollback_confirmed = 'yes'`);
    await db.exec(load("docs/migrations/0018_rollback.sql"));
    await db.exec(`reset gta.rollback_confirmed`);

    const archivedReview = await db.query<{ n: number; f: string }>(
      `select count(*)::int as n, md5(string_agg(id::text || ':' || status || ':' || version::text, ',' order by id)) as f from public.ai_review_items_archive`,
    );
    expect(archivedReview.rows[0]).toEqual({ n: before.review!.n, f: before.review!.f });

    const archivedSources = await db.query<{ n: number; f: string }>(
      `select count(*)::int as n, md5(string_agg(host || ':' || status || ':' || version::text, ',' order by host)) as f from public.ai_sources_allowlist_archive`,
    );
    expect(archivedSources.rows[0]).toEqual({ n: before.sources!.n, f: before.sources!.f });
  });

  it("keeps the audit history exactly as it was", async () => {
    expect(await auditFingerprint()).toEqual(auditBefore);
    expect(auditBefore.n).toBeGreaterThan(0);
  });

  it("keeps lead rows and host rows, and removes the columns and objects that 0018 added", async () => {
    const lead = await db.query<{ label: string }>(`select label from public.ai_leads where id = '${LEAD}'`);
    expect(lead.rows[0]?.label).toBe("Renamed");
    const hosts = await db.query<{ host: string; purpose: string; approved_by: string }>(`select host, purpose, approved_by from public.ai_sources_allowlist`);
    expect(hosts.rows).toEqual([{ host: "visa.example.gov.dz", purpose: "Visa rules v2", approved_by: ADMIN }]);

    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'ai_sources_allowlist' and column_name in ('category','jurisdiction','status','version','last_change_reason')`,
    );
    expect(cols.rows).toEqual([]);
    const liveReview = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'ai_review_items'`);
    expect(liveReview.rows[0]?.n).toBe(0);
    const leadVersion = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'ai_leads' and column_name = 'version'`);
    expect(leadVersion.rows[0]?.n).toBe(0);
  });

  it("the archives are readable by the owner only", async () => {
    const policies = await db.query<{ policyname: string }>(`select policyname from pg_policies where tablename = 'ai_review_items_archive'`);
    expect(policies.rows.map((p) => p.policyname)).toEqual(["ai_review_items_archive_read"]);
  });
});
