import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, asUser } from "./helpers";

/** Migration 0016 on PGlite: owner-only, fixed source identity, append-only observations. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OPERATOR = "00000000-0000-0000-0000-0000000000c1";
const SOURCE = "00000000-0000-0000-0000-000000000005";
const OBS = "00000000-0000-0000-0000-0000000000b1";
const HASH = "a".repeat(64);

let db: PGlite;
const as = (userId: string | null, sql: string, params: unknown[] = []) => asUser<Record<string, unknown>>(db, userId, sql, params);

beforeAll(async () => {
  db = await createTestDb();
  for (const f of ["0002_ai_company.sql", "0016_competitor_intelligence.sql"]) {
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'owner@example.dz', '{}'), ('${OPERATOR}', 'runner@example.dz', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    insert into public.ai_operators (user_id, label) values ('${OPERATOR}', 'runner');
    insert into public.ai_competitor_sources (id, name, url, host, kind, purpose, terms_reviewed_by, terms_reviewed_at, min_interval_hours)
      values ('${SOURCE}', 'Example prices', 'https://example-travel.dz/prices', 'example-travel.dz', 'pricing_page', 'Track prices', 'owner-1', now(), 24);
  `);
});

afterAll(async () => {
  await db.close();
});

describe("competitor sources", () => {
  it("lets the owner register a source with reviewed terms", async () => {
    const rows = await as(
      ADMIN,
      `insert into public.ai_competitor_sources (id, name, url, host, kind, purpose, terms_reviewed_by, terms_reviewed_at, min_interval_hours)
       values ('00000000-0000-0000-0000-000000000009', 'Second', 'https://other-travel.dz/offers', 'other-travel.dz', 'offer_page', 'Track offers', 'owner-1', now(), 24) returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a non-https URL and a host that does not match the URL", async () => {
    await expect(
      as(ADMIN, `insert into public.ai_competitor_sources (id, name, url, host, kind, purpose, terms_reviewed_by, terms_reviewed_at, min_interval_hours)
        values (gen_random_uuid(), 'Bad', 'http://x-travel.dz/', 'x-travel.dz', 'offer_page', 'Track', 'owner-1', now(), 24)`),
    ).rejects.toThrow();
    await expect(
      as(ADMIN, `insert into public.ai_competitor_sources (id, name, url, host, kind, purpose, terms_reviewed_by, terms_reviewed_at, min_interval_hours)
        values (gen_random_uuid(), 'Bad', 'https://x-travel.dz/', 'Upper.DZ', 'offer_page', 'Track', 'owner-1', now(), 24)`),
    ).rejects.toThrow();
  });

  it("keeps the URL and terms record fixed after registration", async () => {
    await expect(as(ADMIN, `update public.ai_competitor_sources set url = 'https://elsewhere.dz/' where id = '${SOURCE}'`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, `update public.ai_competitor_sources set terms_reviewed_by = 'someone' where id = '${SOURCE}'`)).rejects.toThrow(/permission denied/);
  });

  it("lets the owner pause a source and record its check", async () => {
    const rows = await as(ADMIN, `update public.ai_competitor_sources set active = false, last_checked_at = now(), last_status = 'ok' where id = '${SOURCE}' returning active`);
    expect(rows).toEqual([{ active: false }]);
    await as(ADMIN, `update public.ai_competitor_sources set active = true where id = '${SOURCE}'`);
  });

  it("does not allow deleting a source", async () => {
    await expect(as(ADMIN, `delete from public.ai_competitor_sources where id = '${SOURCE}'`)).rejects.toThrow(/permission denied/);
  });
});

describe("observations", () => {
  it("accepts an ok observation with its hash", async () => {
    const rows = await as(
      ADMIN,
      `insert into public.ai_competitor_observations (id, source_id, observed_at, status, content_hash, offers, changes)
       values ('${OBS}', '${SOURCE}', now(), 'ok', '${HASH}', '[{"currency":"EUR","amountMinor":4500,"context":"x"}]', '[]') returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses an ok observation without a hash, and a failed one with a hash", async () => {
    await expect(
      as(ADMIN, `insert into public.ai_competitor_observations (id, source_id, observed_at, status) values (gen_random_uuid(), '${SOURCE}', now(), 'ok')`),
    ).rejects.toThrow();
    await expect(
      as(ADMIN, `insert into public.ai_competitor_observations (id, source_id, observed_at, status, content_hash) values (gen_random_uuid(), '${SOURCE}', now(), 'fetch_failed', '${HASH}')`),
    ).rejects.toThrow();
  });

  it("refuses too many offers in one observation", async () => {
    const many = JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ currency: "EUR", amountMinor: i + 1, context: "x" })));
    await expect(
      as(ADMIN, `insert into public.ai_competitor_observations (id, source_id, observed_at, status, content_hash, offers) values (gen_random_uuid(), '${SOURCE}', now(), 'ok', '${HASH}', '${many}')`),
    ).rejects.toThrow();
  });

  it("does not allow changing or deleting observations", async () => {
    await expect(as(ADMIN, `update public.ai_competitor_observations set status = 'fetch_failed' where id = '${OBS}'`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, `delete from public.ai_competitor_observations where id = '${OBS}'`)).rejects.toThrow(/permission denied/);
  });
});

describe("isolation", () => {
  it("hides sources and observations from the operator account and anonymous visitors", async () => {
    expect(await as(OPERATOR, "select id from public.ai_competitor_sources")).toHaveLength(0);
    expect(await as(OPERATOR, "select id from public.ai_competitor_observations")).toHaveLength(0);
    await expect(as(null, "select id from public.ai_competitor_sources")).rejects.toThrow(/permission denied/);
  });
});
