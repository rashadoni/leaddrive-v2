#!/usr/bin/env bash
# Only public signed receipts leave this disposable, networkless workbench.
set -Eeuo pipefail
umask 077
fatal() { printf 'owner workbench: %s\n' "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fatal 'container root required for private mount ownership'
[ "$(find /sys/class/net -mindepth 1 -maxdepth 1 -printf '%f\n')" = lo ] \
  || fatal 'requires Docker --network none'
for mount in /scratch /database; do
  [ "$(findmnt -n -T "$mount" -o FSTYPE)" = tmpfs ] || fatal 'private scratch and database must be tmpfs'
  chmod 0700 "$mount"
done
started=0
cleanup() {
  if [ "$started" = 1 ]; then
    gosu postgres pg_ctl -D /database/cluster -m immediate -w stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mode="${1:-}"
shift || fatal 'operation required'
if [ "$mode" = --key-proof ]; then
  [ "$#" = 3 ] || fatal 'key proof requires reviewed-main, owner, recipient digest'
  install -d -m 0700 /scratch/keys /scratch/output
  for key in identity.agekey owner-evidence; do
    [ -f "/owner-keys/$key" ] && [ ! -L "/owner-keys/$key" ] || fatal 'private input missing or symlinked'
    install -m 0600 "/owner-keys/$key" "/scratch/keys/$key"
  done
  node /workspace/scripts/backup/owner-key-proof.mjs create \
    /scratch/keys/identity.agekey /scratch/keys/owner-evidence "$3" "$1" "$2" /scratch/output/evidence.env \
    >/scratch/key-proof.log 2>&1 || fatal 'key proof failed; no receipt exported'
elif [ "$mode" = --self-test ] || [ "$mode" = --restore ]; then
  if [ "$mode" = --self-test ]; then
    [ "$#" = 0 ] || fatal 'self-test accepts no input'
  else
    [ "$#" = 5 ] || fatal 'restore requires candidate digest, recipient digest, evidence ref, owner, reviewed-main'
  fi
  chown postgres:postgres /database
  admin_password="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  verifier_password="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  printf '%s\n' "$admin_password" >/database/init.pass
  chown postgres:postgres /database/init.pass
  gosu postgres initdb -D /database/cluster -A scram-sha-256 -U scratch_admin --pwfile=/database/init.pass \
    >/database/init.log 2>&1 || fatal 'scratch cluster initialization failed'
  gosu postgres pg_ctl -D /database/cluster -l /database/server.log \
    -o '-h 127.0.0.1 -p 55432 -k /database' -w start >/database/start.log 2>&1 \
    || fatal 'scratch cluster start failed'
  started=1
  PGPASSWORD="$admin_password" psql -X -h 127.0.0.1 -p 55432 -U scratch_admin -d postgres -v ON_ERROR_STOP=1 \
    >/database/bootstrap.log 2>&1 <<SQL
CREATE ROLE owner_restore_verifier LOGIN NOSUPERUSER CREATEDB PASSWORD '$verifier_password';
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO owner_restore_verifier;
SQL
  printf '127.0.0.1:55432:*:owner_restore_verifier:%s\n' "$verifier_password" >/scratch/pgpass
  unset admin_password verifier_password PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS
  export VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT=55432 VERIFY_PGUSER=owner_restore_verifier
  export VERIFY_PGPASSFILE=/scratch/pgpass VERIFY_PGMAINTENANCE_DB=postgres VERIFY_PGSSLMODE=disable
  export OFFLINE_SCRATCH_ROOT=/scratch
  export OFFLINE_DATABASE_STORAGE_ATTESTATION=DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED
  role="$(PGPASSFILE=/scratch/pgpass psql -X -h 127.0.0.1 -p 55432 -U owner_restore_verifier -d postgres -Atc \
    'select rolsuper::int, rolcreatedb::int from pg_roles where rolname=current_user')"
  [ "$role" = '0|1' ] || fatal 'scratch role privileges differ'
  if [ "$mode" = --self-test ]; then
    [ "$(age --version)" = v1.3.2 ] || fatal 'unexpected age version'
    printf '#!/bin/bash\nprintf scratch-script-readable\n' >/scratch/noexec-probe.sh
    chmod 0600 /scratch/noexec-probe.sh
    [ "$(bash /scratch/noexec-probe.sh)" = scratch-script-readable ] || fatal 'scratch script interpretation failed'
    printf 'networkless ephemeral PostgreSQL, interpreted scratch helper and pinned age: passed\n'
    exit 0
  fi
  install -d -m 0700 /scratch/keys /scratch/output
  for key in identity.agekey owner-evidence; do
    [ -f "/owner-keys/$key" ] && [ ! -L "/owner-keys/$key" ] || fatal 'private input missing or symlinked'
    install -m 0600 "/owner-keys/$key" "/scratch/keys/$key"
  done
  bash /workspace/scripts/backup/verify-offline-backup.sh --owner-operated \
    /ciphertext/database.tar.age /ciphertext/secrets.tar.age /ciphertext/runtime-files.tar.age \
    /ciphertext/candidate.env /scratch/keys/identity.agekey "$1" "$2" "$3" "$4" \
    /scratch/keys/owner-evidence /scratch/output/evidence.env "$5" \
    >/scratch/restore.log 2>&1 || fatal 'restore verification failed; no receipt exported'
else
  fatal 'unknown operation'
fi
# No overwrite of prior evidence. No private keys, SQL, logs or plaintext export.
for output in /scratch/output/evidence.env*; do
  [ -f "$output" ] && [ ! -L "$output" ] || fatal 'signed evidence missing'
  [ ! -e "/output/$(basename "$output")" ] || fatal 'output already exists'
done
for output in /scratch/output/evidence.env*; do
  cp --no-clobber "$output" /output/
done
printf 'signed owner evidence exported; independent review not performed\n'
