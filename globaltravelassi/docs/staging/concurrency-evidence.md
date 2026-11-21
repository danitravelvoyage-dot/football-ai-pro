# Concurrency evidence on a real PostgreSQL server

Recorded by `scripts/pg-concurrency-check.sh` on a local, throwaway PostgreSQL 16 cluster (not Supabase, not production).

```
Scenario 1: removal holds the file; a submission of the same file must wait, then be refused
  PASS submission refused because the removal holds the file
  PASS the submission waited for the removal's lock (>= 1500 ms)
  PASS no payment refers to the removed file
Scenario 2: a submission holds the file; a removal of the same file must wait, then be refused
  PASS removal refused because the file is now referenced
  PASS the removal waited for the submission's lock (>= 1500 ms)
  PASS the referenced file was not removed
Scenario 3: two owner decisions on the same proof at the same time: exactly one applies
  PASS exactly one decision applied
  PASS the other was refused as already decided
  PASS one final status, with its audit row

CONCURRENCY CHECK: all checks passed on PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.
```

What this shows: each scenario ran two real sessions at once. The waiting checks compare elapsed time with a 1500 ms threshold, so they show the second session blocked on the first session's lock; the outcome checks show which side won. Limits: one server, one run, no Supabase roles; this does not replace a staging run.
