#!/usr/bin/env bash
# Enrol the production web/PostgreSQL host as the CDC source of the Kafka
# cluster. Runs on that host as root, one phase per call, each idempotent:
#
#   source-enroll.sh prepare            install WireGuard, create the host key, print WG_PUBLIC_KEY
#   source-enroll.sh network DIR        install wg0.conf + nftables.conf + ufw.sh from DIR, start wg0
#   source-enroll.sh postgres-config    conf.d drop-in + pg_hba block; takes effect at the next restart
#   source-enroll.sh restart            safety pg_dump, restart PostgreSQL, verify settings
#   source-enroll.sh cdc-role           repo prepare-cdc.sql; password from stdin (never argv/env/logs)
#   source-enroll.sh status             read-only summary
#
# Environment: OVERLAY_ADDR (this host on the mesh), CONNECT_ADDRS (comma list
# of Connect hosts), DBNAME (default leaddrive_v2), PG_VERSION (default 16),
# REPO_SQL (path to prepare-cdc.sql copied next to this script).
#
# Deliberately untouched: the server certificate. Backups connect with
# verify-full pinned to the existing certificate and host name, so Debezium
# uses the same name (mapped to the overlay address) and the same trust anchor.
set -Eeuo pipefail
die() { printf 'source-enroll: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

pg_version="${PG_VERSION:-16}"
conf_dir="/etc/postgresql/$pg_version/main"
dbname="${DBNAME:-leaddrive_v2}"
dropin="$conf_dir/conf.d/90-leaddrive-cdc.conf"
hba="$conf_dir/pg_hba.conf"
psql_su() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 "$@"; }
need_addr() {
  [[ "${OVERLAY_ADDR:-}" =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "OVERLAY_ADDR must be the 10.x mesh address"
  [[ "${CONNECT_ADDRS:-}" =~ ^10\.[0-9.]+(,10\.[0-9.]+)*$ ]] || die "CONNECT_ADDRS must list 10.x Connect addresses"
}

case "${1:-}" in
  prepare)
    export DEBIAN_FRONTEND=noninteractive
    command -v wg >/dev/null || { apt-get update -qq; apt-get install -y -qq wireguard-tools nftables >/dev/null; }
    install -d -m 0700 /etc/wireguard
    [ -s /etc/wireguard/ld-kafka.key ] || (umask 077; wg genkey >/etc/wireguard/ld-kafka.key)
    install -d -m 0755 /etc/leaddrive-kafka
    printf 'WG_PUBLIC_KEY=%s\n' "$(wg pubkey </etc/wireguard/ld-kafka.key)"
    ;;

  network)
    dir="${2:-}"; for f in wg0.conf nftables.conf ufw.sh; do [ -s "$dir/$f" ] || die "$dir/$f missing"; done
    nft -c -f "$dir/nftables.conf" || die "nftables ruleset rejected"
    install -m 0600 "$dir/nftables.conf" /etc/leaddrive-kafka/nftables.conf
    install -m 0600 "$dir/wg0.conf" /etc/wireguard/wg0.conf
    install -m 0644 /dev/stdin /etc/systemd/system/ld-kafka-firewall.service <<'EOF'
[Unit]
Description=LeadDrive Kafka overlay confinement on the source host
After=network-pre.target
Before=wg-quick@wg0.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/leaddrive-kafka/nftables.conf

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now ld-kafka-firewall >/dev/null
    nft -f /etc/leaddrive-kafka/nftables.conf
    bash "$dir/ufw.sh" >/dev/null
    systemctl enable wg-quick@wg0 >/dev/null
    systemctl restart wg-quick@wg0
    wg show wg0 | head -3
    ;;

  postgres-config)
    need_addr
    [ -d "$conf_dir/conf.d" ] || die "$conf_dir/conf.d missing"
    grep -qE "^include_dir = 'conf.d'" "$conf_dir/postgresql.conf" || die "postgresql.conf does not include conf.d"
    install -m 0644 -o postgres -g postgres /dev/stdin "$dropin" <<EOF
# LeadDrive event CDC (scripts/event-platform/cluster/source-enroll.sh)
wal_level = logical
# Bound WAL a stalled CDC slot may pin; at ~0.3 GB/day this is weeks of outage.
max_slot_wal_keep_size = 16GB
max_replication_slots = 10
max_wal_senders = 10
listen_addresses = 'localhost,$OVERLAY_ADDR'
EOF
    tmp="$(mktemp)"
    awk '/^# BEGIN leaddrive-cdc/{skip=1} !skip{print} /^# END leaddrive-cdc/{skip=0}' "$hba" >"$tmp"
    {
      echo '# BEGIN leaddrive-cdc (source-enroll.sh): TLS only, CDC role only, Connect hosts only'
      IFS=, read -ra addrs <<<"$CONNECT_ADDRS"
      for a in "${addrs[@]}"; do
        printf 'hostssl replication leaddrive_event_cdc %s/32 scram-sha-256\n' "$a"
        printf 'hostssl %s leaddrive_event_cdc %s/32 scram-sha-256\n' "$dbname" "$a"
      done
      echo '# END leaddrive-cdc'
    } >>"$tmp"
    install -m 0640 -o postgres -g postgres "$tmp" "$hba"; rm -f "$tmp"
    echo "drop-in and pg_hba block written; restart required for wal_level/listen_addresses"
    ;;

  restart)
    need_addr
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 0700 /var/backups/leaddrive-pre-cdc
    sudo -u postgres pg_dump -Fc -d "$dbname" >"/var/backups/leaddrive-pre-cdc/$dbname-$stamp.dump"
    chmod 0600 "/var/backups/leaddrive-pre-cdc/$dbname-$stamp.dump"
    sudo -u postgres pg_restore -l "/var/backups/leaddrive-pre-cdc/$dbname-$stamp.dump" >/dev/null || die "safety dump unreadable"
    echo "safety dump: /var/backups/leaddrive-pre-cdc/$dbname-$stamp.dump ($(du -h "/var/backups/leaddrive-pre-cdc/$dbname-$stamp.dump" | cut -f1))"
    start=$(date +%s%N)
    systemctl restart "postgresql@$pg_version-main"
    for _ in $(seq 60); do sudo -u postgres pg_isready -q && break; sleep 0.5; done
    sudo -u postgres pg_isready -q || die "PostgreSQL did not come back"
    echo "PostgreSQL back after $(( ($(date +%s%N) - start) / 1000000 )) ms"
    [ "$(psql_su -Atc 'show wal_level')" = logical ] || die "wal_level is not logical after restart"
    [ "$(psql_su -Atc 'show max_slot_wal_keep_size')" = 16GB ] || die "max_slot_wal_keep_size not applied"
    ss -ltn | grep -q "$OVERLAY_ADDR:5432" || die "PostgreSQL is not listening on $OVERLAY_ADDR"
    ;;

  cdc-role)
    sql="${REPO_SQL:-$(dirname "$0")/prepare-cdc.sql}"
    [ -s "$sql" ] || die "prepare-cdc.sql not found"
    IFS= read -r password || die "password expected on stdin"
    [[ "$password" =~ ^[A-Za-z0-9]{32,}$ ]] || die "password must be >= 32 alphanumeric characters"
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -v DBNAME="$dbname" -d "$dbname" -f "$sql" >/dev/null
    # The password reaches PostgreSQL through stdin and is hashed there (scram).
    printf "SET log_statement = 'none';\nALTER ROLE leaddrive_event_cdc PASSWORD '%s';\n" "$password" | psql_su -d "$dbname" -q >/dev/null
    echo "CDC role, RLS policy and publication prepared; password set"
    ;;

  status)
    psql_su -d "$dbname" -At <<'SQL'
select 'wal_level='||current_setting('wal_level')||' slot_cap='||current_setting('max_slot_wal_keep_size')||' listen='||current_setting('listen_addresses');
select 'cdc_role='||count(*) from pg_roles where rolname='leaddrive_event_cdc';
select 'publication='||count(*) from pg_publication where pubname='leaddrive_event_outbox';
select 'slots='||coalesce(string_agg(slot_name||':'||active, ','), 'none') from pg_replication_slots;
SQL
    wg show wg0 latest-handshakes 2>/dev/null | wc -l | sed 's/^/tunnel peers=/'
    ;;

  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
