# Staging execution plan for migrations 0002 to 0018

**Status: planned, nothing executed.** Migration 0018 and the migrations it depends on wait for the owner's approval. Production is out of scope.


> **Update (manual payments):** migration `0019_manual_payments.sql` was added after this plan was written. It depends only on the base schema (0001) and must be added to the execution order, and its checksum recorded, before any staging run. The checksum table above lists 0002 to 0018 only.

## 1. Supabase inspection (read only, done in this phase)

| Project | Ref | Status | Migration history | Tables in `public` |
| --- | --- | --- | --- | --- |
| `globaltravelassi` | `feknppmxasoxmwplxvpa` | `ACTIVE_HEALTHY`, Postgres 17.12, eu-west-1 | empty | `profiles`, `services`, `applications`, `documents`, `payments`, `application_notes`, `application_events` |
| `visa-ready-dz` | `pcreairqaqxistybmnnb` | `INACTIVE`, eu-west-3 | not inspected | not inspected |

What this shows:
- No `ai_*` table exists in `globaltravelassi`. None of migrations 0002 to 0018 is applied there, and the migration history is empty.
- The project holds customer-shaped tables with rows (for example 2 applications, 2 documents, 3 profiles). It looks like a live project. **It must not be the staging target.**
- `visa-ready-dz` is inactive and was not touched.

**Decision needed:** create a separate staging project, with its own URL and keys, before any migration runs. Creating a project may have a cost, so it needs the owner's approval.

## 2. Gates (none of these is passed yet)

1. Owner reviews migration 0018, the rollback script and this plan.
2. Owner approves creating a separate staging project.
3. Owner approves the backup of the staging project before the first run (an empty staging project needs no data backup, but the schema backup is still taken).
4. Owner approves the run of migrations 0002 to 0018 on staging, in order.
5. Owner approves the post-migration checks.
6. Production is not part of this plan. A production migration needs a separate plan and approval.

## 3. Migrations, in order

Each file must match the checksum in `docs/migrations/manifest.json` before it is run.

| Order | File | SHA-256 (first 16 hex) |
| --- | --- | --- |
| 1 | `0001_init.sql` | `22080b87799ffc1b…` |
| 2 | `0002_ai_company.sql` | `06b860344f8baa8e…` |
| 3 | `0003_agent_seed.sql` | `be43a327cf4aef9a…` |
| 4 | `0004_event_bus.sql` | `27e7f1ae9d8112b9…` |
| 5 | `0005_shared_context.sql` | `ca6fc793ecd72c64…` |
| 6 | `0006_knowledge_base.sql` | `c79ca9c3bcd8efae…` |
| 7 | `0007_approval_controls.sql` | `7487fb4e5392359a…` |
| 8 | `0008_quality_reviews.sql` | `debc935e8ff04b80…` |
| 9 | `0009_business_memory.sql` | `595b4ba37e0619f4…` |
| 10 | `0010_append_only_hardening.sql` | `0922ebc0aa075042…` |
| 11 | `0011_scheduler.sql` | `6d59f79981a97afa…` |
| 12 | `0012_owner_notifications.sql` | `41ec3663d5206c60…` |
| 13 | `0013_campaigns_content_knowledge.sql` | `2dc7e1935cbeaff9…` |
| 14 | `0014_usage_token_split.sql` | `f136f1495b498a96…` |
| 15 | `0015_crm_sales.sql` | `daec756a3c5111b3…` |
| 16 | `0016_competitor_intelligence.sql` | `efe34c3651b09a08…` |
| 17 | `0017_collaboration.sql` | `5f93e540a6363c8f…` |
| 18 | `0018_owner_approval_center.sql` | `86d5b8025c645e57…` |

The rollback script is `docs/migrations/0018_rollback.sql` (SHA-256 `92a6f597a036938d…`). It is not part of the chain.

## 4. Pre-migration backup and checksum check

Full procedure: `docs/migrations/0018_backup_procedure.md`. Summary:

```bash
# 1. Verify every migration file against the manifest. Stop if any line differs.
node -e 'const c=require("crypto"),f=require("fs");const m=require("./docs/migrations/manifest.json").files;for(const[k,v] of Object.entries(m)){const h=c.createHash("sha256").update(f.readFileSync(k)).digest("hex");if(h!==v){console.error("MISMATCH",k);process.exit(1)}}console.log("all checksums match")'

# 2. Schema and data backup of the staging project, taken before the first run.
pg_dump "$STAGING_DATABASE_URL" --schema-only --file staging-schema-before.sql
pg_dump "$STAGING_DATABASE_URL" --data-only --file staging-data-before.sql
sha256sum staging-schema-before.sql staging-data-before.sql > staging-backup.sha256
```

Store the backup and its checksum file outside the repository. Restoring it into an empty database is the test that the backup works.

## 5. Execution (after gates 1 to 4)

Apply the migrations in the table order, one file per run, stopping on the first error. Run each file in its own transaction where the file allows it, and record the time and the output. The chain test (`tests/db/migration-chain.test.ts`) applies the same files on PGlite before any staging run.

## 6. Post-migration verification

Run as the owner, on staging only:

```sql
-- Every integrity check must pass.
select check_name, passed, detail from public.ai_audit_integrity_report() where not passed;   -- expect no rows

-- Counts: compare with the pre-migration values (empty tables on a new staging project).
select count(*) as review_items from public.ai_review_items;
select count(*) as sources from public.ai_sources_allowlist;
select count(*) as audit_events from public.ai_events;
```

Also check that the chain's last migration is 0018 and that no table outside `public.ai_*` changed.

## 7. Rollback

Only if the owner asks, and only after the archive procedure in `docs/migrations/0018_backup_procedure.md`. The rollback runs in one transaction, copies the review items and registry metadata first, and checks the copies. It keeps the audit history and the host rows.

## 8. What this plan does not cover

- Production.
- Email, deployment or publishing.
- Any change to customer tables (`profiles`, `applications`, `documents`, `payments`, and the rest).
