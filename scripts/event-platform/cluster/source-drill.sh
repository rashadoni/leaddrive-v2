#!/usr/bin/env bash
# Disposable drill of source-enroll.sh on a stock Ubuntu 24.04 + PostgreSQL 16
# that mirrors production: Debian snakeoil certificate, backups connecting with
# verify-full pinned to it, event_outbox from the foundation migration.
# Proves the window's PostgreSQL steps keep the backup path working, admit the
# CDC role only over TLS from Connect addresses, refuse everyone else, and are
# idempotent. Run as root on a disposable runner with LD_KAFKA_DRILL_DISPOSABLE=1.
set -Eeuo pipefail
[ "${LD_KAFKA_DRILL_DISPOSABLE:-}" = 1 ] || { echo "refusing: disposable runners only" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"; repo="$here/../../.."
fail() { printf 'SOURCE DRILL FAILED: %s\n' "$*" >&2; exit 1; }
ok() { printf 'ok    %s\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql-16 ssl-cert wireguard-tools nftables >/dev/null
tls_name="ld-source-drill.example"
# Production's snakeoil names the host; reproduce that relationship.
grep -q "$tls_name" /etc/hosts || echo "127.0.0.1 $tls_name" >>/etc/hosts
make-ssl-cert generate-default-snakeoil --force-overwrite >/dev/null 2>&1 || true
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$tls_name" -addext "subjectAltName=DNS:$tls_name" \
  -keyout /etc/ssl/private/ssl-cert-snakeoil.key -out /etc/ssl/certs/ssl-cert-snakeoil.pem 2>/dev/null
chgrp ssl-cert /etc/ssl/private/ssl-cert-snakeoil.key; chmod 0640 /etc/ssl/private/ssl-cert-snakeoil.key
systemctl restart postgresql@16-main
for _ in $(seq 40); do sudo -u postgres pg_isready -q && break; sleep 0.5; done

sudo -u postgres psql -X -qv ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE leaddrive_v2;
CREATE ROLE leaddrive_backup LOGIN BYPASSRLS PASSWORD 'backup-drill-password-0123456789';
SQL
awk '/CREATE TABLE "event_outbox"/,/\);/' "$repo/prisma/migrations/20260901090000_event_platform_foundation/migration.sql" \
  | sudo -u postgres psql -X -qv ON_ERROR_STOP=1 -d leaddrive_v2
sudo -u postgres psql -X -qv ON_ERROR_STOP=1 -d leaddrive_v2 -c 'GRANT SELECT ON "event_outbox" TO leaddrive_backup'
backup_check() {
  PGPASSWORD=backup-drill-password-0123456789 PGSSLMODE=verify-full PGSSLROOTCERT=/etc/ssl/certs/ssl-cert-snakeoil.pem \
    psql -X -h "$tls_name" -U leaddrive_backup -d leaddrive_v2 -Atc 'select count(*) from "event_outbox"' >/dev/null
}
backup_check || fail "baseline backup connection (verify-full on the snakeoil) does not work"
ok "baseline: backup connects with verify-full pinned to the existing certificate"

# A Connect host on the overlay: its own namespace at 10.88.0.16; the source keeps 10.88.0.26.
ip netns add ldconnect; ip link add ldsrc type veth peer name ldcon netns ldconnect
ip addr add 10.88.0.26/24 dev ldsrc; ip link set ldsrc up
ip -n ldconnect addr add 10.88.0.16/24 dev ldcon; ip -n ldconnect link set ldcon up; ip -n ldconnect link set lo up
ip netns add ldother; ip link add ldsrc2 type veth peer name ldoth netns ldother
ip addr add 10.88.1.1/24 dev ldsrc2; ip link set ldsrc2 up
ip -n ldother addr add 10.88.1.99/24 dev ldoth; ip -n ldother link set ldoth up
ip -n ldother route add 10.88.0.0/24 via 10.88.1.1
grep -q "10.88.0.26 $tls_name" /etc/netns/ldconnect/hosts 2>/dev/null || { mkdir -p /etc/netns/ldconnect; printf '127.0.0.1 localhost\n10.88.0.26 %s\n' "$tls_name" >/etc/netns/ldconnect/hosts; }

export OVERLAY_ADDR=10.88.0.26 CONNECT_ADDRS=10.88.0.16 DBNAME=leaddrive_v2
cp "$repo/ops/event-platform/postgres/prepare-cdc.sql" "$here/prepare-cdc.sql.drill"
for run in 1 2; do bash "$here/source-enroll.sh" postgres-config >/dev/null; done
[ "$(grep -c '^# BEGIN leaddrive-cdc' /etc/postgresql/16/main/pg_hba.conf)" = 1 ] || fail "pg_hba block duplicated on re-run"
ok "postgres-config is idempotent (one pg_hba block after two runs)"
bash "$here/source-enroll.sh" restart | sed 's/^/      /'
backup_check || fail "backup connection broke after the restart"
ok "backup still connects with verify-full after the restart"
password="$(openssl rand -hex 24)"
for run in 1 2; do printf '%s\n' "$password" | REPO_SQL="$here/prepare-cdc.sql.drill" bash "$here/source-enroll.sh" cdc-role >/dev/null; done
ok "cdc-role is idempotent"
bash "$here/source-enroll.sh" status | sed 's/^/      /'

cdc() { # cdc NETNS HOST SSLMODE [replication] -> exit status of IDENTIFY_SYSTEM / SELECT
  local ns="$1" host="$2" mode="$3" repl="${4:-}"
  local conn="host=$host port=5432 dbname=leaddrive_v2 user=leaddrive_event_cdc password=$password sslmode=$mode sslrootcert=/etc/ssl/certs/ssl-cert-snakeoil.pem connect_timeout=5"
  if [ -n "$repl" ]; then ip netns exec "$ns" psql -X "$conn replication=database" -Atc 'IDENTIFY_SYSTEM' >/dev/null 2>&1
  else ip netns exec "$ns" psql -X "$conn" -Atc 'select count(*) from "event_outbox"' >/dev/null 2>&1; fi
}
cdc ldconnect "$tls_name" verify-full repl || fail "CDC replication connection from the Connect address was refused"
ok "Connect address: replication over TLS with verify-full on the existing certificate"
cdc ldconnect "$tls_name" verify-full || fail "CDC snapshot connection from the Connect address was refused"
ok "Connect address: snapshot SELECT over TLS"
! cdc ldconnect "$tls_name" disable repl || fail "CDC was admitted without TLS"
ok "refused: CDC without TLS"
! cdc ldother 10.88.0.26 require repl || fail "CDC was admitted from a non-Connect overlay address"
ok "refused: CDC from another overlay address"
! ip netns exec ldconnect psql -X "host=$tls_name dbname=leaddrive_v2 user=leaddrive_backup password=backup-drill-password-0123456789 sslmode=require connect_timeout=5" -Atc 'select 1' >/dev/null 2>&1 \
  || fail "a non-CDC role was admitted from the overlay"
ok "refused: other roles from the overlay"
[ "$(sudo -u postgres psql -XAtc "select count(*) from pg_replication_slots")" = 0 ] || fail "enrolment must not create a slot"
ok "no replication slot exists until the connector starts"
echo "SOURCE DRILL PASSED"
