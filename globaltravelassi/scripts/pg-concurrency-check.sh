#!/usr/bin/env bash
# Concurrency check on a REAL PostgreSQL server. Local only: it refuses any host other than a local socket or
# 127.0.0.1 unless ALLOW_REMOTE=1 is set. It creates a fresh database, applies the stubs and migrations 0001 to 0019
# in order, runs the scenarios below with two real sessions at a time, checks the outcomes, and drops the database.
#
# Usage: PGHOST=/path/to/socket PGPORT=55432 PGUSER=postgres scripts/pg-concurrency-check.sh
# It is NOT part of npm run verify. It needs a running PostgreSQL server, which the sandbox provides locally.
set -euo pipefail
# Hide the "does not exist, skipping" notices that the idempotent migrations print.
export PGOPTIONS="-c client_min_messages=warning"

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="gta_concurrency_$$"

case "$PGHOST" in
  /*|127.0.0.1|localhost) ;;
  *) [ "${ALLOW_REMOTE:-0}" = "1" ] || { echo "Refusing non-local host: $PGHOST (set ALLOW_REMOTE=1 to override)"; exit 2; } ;;
esac

psqlq() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -qAt "$@"; }
psqlq_db() { psqlq -d "$DB" "$@"; }
cleanup() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psqlq -d postgres -c "create database $DB" >/dev/null
psqlq_db -f "$ROOT/tests/db/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do psqlq_db -f "$f" >/dev/null; done

OWNER=00000000-0000-0000-0000-0000000000a1
CUST=00000000-0000-0000-0000-0000000000b1
SERVICE=00000000-0000-0000-0000-0000000000c1
X=00000000-0000-0000-0000-0000000000e1   # approved request: submits a proof, and is the folder for removal R1
Y=00000000-0000-0000-0000-0000000000e2   # approved request: the submit-then-remove race
Z=00000000-0000-0000-0000-0000000000e3   # request with one proof awaiting review: the double-decision race
R1=$CUST/$X/payment-old-r1.pdf
R2=$CUST/$Y/payment-old-r2.pdf
PAY=00000000-0000-0000-0000-0000000000f1

psqlq_db -c "
insert into auth.users (id, email) values ('$OWNER','o@x.dz'), ('$CUST','c@x.dz');
update public.profiles set role='admin' where id='$OWNER';
insert into public.services (id, slug, category, title_ar, title_fr, title_en, price, currency)
  values ('$SERVICE','race-fixture','visa','aa','bb','cc',15000,'DZD');
insert into public.applications (id,user_id,service_id,full_name,email,whatsapp,nationality,country_of_residence,destination_country,employment_status,status)
  values ('$X','$CUST','$SERVICE','Client Test','c@x.dz','+213612345678','DZ','DZ','FR','employed','approved'),
         ('$Y','$CUST','$SERVICE','Client Test','c@x.dz','+213612345678','DZ','DZ','FR','employed','approved'),
         ('$Z','$CUST','$SERVICE','Client Test','c@x.dz','+213612345678','DZ','DZ','FR','employed','approved');
update public.payment_method_settings set enabled=true, instructions_fr='fr', instructions_en='en', instructions_ar='ar' where method='usdt';
insert into storage.objects (bucket_id,name,created_at) values
  ('customer-documents','$R1', now()-interval '30 days'),
  ('customer-documents','$R2', now()-interval '30 days');
" >/dev/null

# A session as a signed-in user: the same role and claim the API uses.
as_user() { local uid="$1"; shift; psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -qAt -c "set role authenticated; set request.jwt.claim.sub='$uid'; $*" 2>&1 || true; }
now_ms() { date +%s%3N; }
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "  PASS $1"; else echo "  FAIL $1: expected [$3] got [$2]"; FAILS=$((FAILS+1)); fi; }

echo "Scenario 1: removal holds the file; a submission of the same file must wait, then be refused"
as_user $OWNER "begin; select public.begin_orphan_removal('$R1','race scenario 1'); select pg_sleep(3); commit;" >/tmp/gta-s1a.txt &
sleep 1
start=$(now_ms)
out=$(as_user $CUST "select public.submit_payment_evidence('$X','usdt','$R1','application/pdf',1000,'p.pdf');")
waited=$(( $(now_ms) - start ))
wait
check "submission refused because the removal holds the file" "$(echo "$out" | grep -c 'being removed')" "1"
check "the submission waited for the removal's lock (>= 1500 ms)" "$([ $waited -ge 1500 ] && echo yes || echo no)" "yes"
check "no payment refers to the removed file" "$(psqlq_db -c "select count(*) from public.payments where evidence_path='$R1'")" "0"

echo "Scenario 2: a submission holds the file; a removal of the same file must wait, then be refused"
R2_FRESH=$CUST/$Y/payment-old-r2.pdf
as_user $CUST "begin; select public.submit_payment_evidence('$Y','usdt','$R2_FRESH','application/pdf',1000,'p.pdf'); select pg_sleep(3); commit;" >/tmp/gta-s2a.txt &
sleep 1
start=$(now_ms)
out=$(as_user $OWNER "select public.begin_orphan_removal('$R2_FRESH','race scenario 2');")
waited=$(( $(now_ms) - start ))
wait
check "removal refused because the file is now referenced" "$(echo "$out" | grep -c 'not eligible')" "1"
check "the removal waited for the submission's lock (>= 1500 ms)" "$([ $waited -ge 1500 ] && echo yes || echo no)" "yes"
check "the referenced file was not removed" "$(psqlq_db -c "select count(*) from storage.objects where name='$R2_FRESH'")" "1"

echo "Scenario 3: two owner decisions on the same proof at the same time: exactly one applies"
psqlq_db -c "insert into storage.objects (bucket_id,name) values ('customer-documents','$CUST/$Z/payment-z.pdf')" >/dev/null
as_user $CUST "select public.submit_payment_evidence('$Z','usdt','$CUST/$Z/payment-z.pdf','application/pdf',1000,'p.pdf');" >/dev/null
PAYZ=$(psqlq_db -c "select id from public.payments where application_id='$Z' and status='pending_review'")
[ -n "$PAYZ" ] || { echo "  FAIL setup: no pending proof for scenario 3"; exit 1; }
as_user $OWNER "select public.decide_payment('$PAYZ','approve','first decision');" >/tmp/gta-d1.txt &
as_user $OWNER "select public.decide_payment('$PAYZ','reject','second decision','The amount is wrong.');" >/tmp/gta-d2.txt &
wait
applied=$(cat /tmp/gta-d1.txt /tmp/gta-d2.txt | grep -cE '^(received|rejected)$' || true)
refused=$(cat /tmp/gta-d1.txt /tmp/gta-d2.txt | grep -c 'already decided' || true)
check "exactly one decision applied" "$applied" "1"
check "the other was refused as already decided" "$refused" "1"
check "one final status, with its audit row" "$(psqlq_db -c "select count(*) from public.payment_audit where payment_id='$PAYZ' and action in ('approved','rejected')")" "1"

echo
if [ "$FAILS" -eq 0 ]; then echo "CONCURRENCY CHECK: all checks passed on $(psqlq_db -c 'select version()' | cut -c1-40)"; else echo "CONCURRENCY CHECK: $FAILS check(s) failed"; exit 1; fi
