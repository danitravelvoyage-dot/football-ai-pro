# Migration 0018: backup, verification and rollback procedure

Migration 0018 is **not applied**. This procedure applies only after the owner has approved it, and only to the database named by the owner. Production is never the first target.

## Before any rollback

1. **Stop new decisions.** Ask the owner to pause the approval center. Confirm no request is running.
2. **Fingerprint the live data.** Run and keep the output:

   ```sql
   select 'review_items' as table_name, count(*) as rows,
          md5(string_agg(id::text || ':' || status || ':' || version::text, ',' order by id)) as fingerprint
     from public.ai_review_items
   union all
   select 'sources', count(*),
          md5(string_agg(host || ':' || status || ':' || version::text, ',' order by host))
     from public.ai_sources_allowlist
   union all
   select 'leads_versions', count(*), md5(string_agg(id::text || ':' || version::text, ',' order by id))
     from public.ai_leads
   union all
   select 'audit_events', count(*), md5(string_agg(id::text, ',' order by id))
     from public.ai_events;
   ```

3. **Export the data.** Save each table to a CSV file outside the repository, then record its SHA-256:

   ```bash
   psql "$DATABASE_URL" -c "\copy (select * from public.ai_review_items order by id) to 'review_items.csv' csv header"
   psql "$DATABASE_URL" -c "\copy (select * from public.ai_sources_allowlist order by host) to 'sources.csv' csv header"
   sha256sum review_items.csv sources.csv
   ```

4. **Verify the export in a disposable database.** Load the CSV files into an empty throwaway database, then re-run the fingerprint query. The numbers must match step 2.

## Rollback

Run `docs/migrations/0018_rollback.sql` only after steps 1 to 4. The script refuses to run without the confirmation setting, refuses to overwrite an earlier archive, copies the data into `*_archive` tables, checks the copies against the live tables, and only then removes the 0018 objects. It runs in one transaction.

```sql
set gta.rollback_confirmed = 'yes';
\i docs/migrations/0018_rollback.sql
```

After the rollback, run the fingerprint query again. `audit_events` must be unchanged. The archive tables must match the fingerprints from step 2.

## What the rollback removes, and what it keeps

| Object | Effect |
| --- | --- |
| `ai_review_items` | Copied to `ai_review_items_archive`, then dropped from the live schema |
| `ai_sources_allowlist` metadata columns | Copied to `ai_sources_allowlist_archive`, then the columns are dropped |
| `ai_leads.version` | Dropped. A concurrency token only |
| 0018 triggers, functions, policies | Dropped. The 0002 policy is restored. The delete grant is not |
| `ai_events` | Not touched. Append-only audit history |
| Lead rows, host rows | Not touched |

## Keeping the audit trail

Decisions and source changes are written to `ai_events` by the application and, independently, by database triggers (`db.review.decided`, `db.source.*`). The rollback does not change `ai_events`. Archives are read-only for API roles.

## Known limit

A database owner can disable a trigger. That is a privilege. The fingerprint and archive checks are what detect it after the fact.
