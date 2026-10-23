#!/usr/bin/env bash
# First-time preparation of a freshly ordered Kafka host (Ubuntu 24.04), run
# as root over SSH by provision.sh. Idempotent: rerunning changes nothing that
# is already in place. Prints exactly one line "WG_PUBLIC_KEY=<key>" for the
# operator's inventory; the WireGuard private key never leaves the host.
#
# Not for the production web host: its tunnel/firewall step is separate.
set -Eeuo pipefail
die() { printf 'host-bootstrap: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = 24.04 ] || die "expected Ubuntu 24.04, found ${PRETTY_NAME:-unknown}"
kafka_uid="${KAFKA_UID:?KAFKA_UID is required}"
[[ "$kafka_uid" =~ ^[0-9]+$ ]] && [ "$kafka_uid" -ge 10000 ] || die "KAFKA_UID must be a system-unused uid >= 10000"
! getent passwd "$kafka_uid" >/dev/null || [ "$(getent passwd "$kafka_uid" | cut -d: -f1)" = ld-kafka ] \
  || die "uid $kafka_uid already belongs to another account"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 wireguard-tools nftables chrony unattended-upgrades >/dev/null
systemctl enable --now docker chrony >/dev/null

# Keys only: the provider's root password must not open SSH.
install -m 0644 /dev/stdin /etc/ssh/sshd_config.d/01-leaddrive-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh

install -m 0644 /dev/stdin /etc/sysctl.d/90-leaddrive-kafka.conf <<'EOF'
vm.swappiness = 1
vm.max_map_count = 262144
net.core.somaxconn = 4096
EOF
sysctl --system >/dev/null

getent group ld-kafka >/dev/null || groupadd --system --gid "$kafka_uid" ld-kafka
getent passwd ld-kafka >/dev/null || useradd --system --uid "$kafka_uid" --gid "$kafka_uid" \
  --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ld-kafka
install -d -m 0750 -o ld-kafka -g ld-kafka /var/lib/leaddrive-kafka
install -d -m 0755 /etc/leaddrive-kafka
install -d -m 0750 -o root -g ld-kafka /etc/leaddrive-kafka/tls
install -d -m 0700 /etc/wireguard

if [ ! -s /etc/wireguard/ld-kafka.key ]; then
  (umask 077; wg genkey >/etc/wireguard/ld-kafka.key)
fi
chmod 0600 /etc/wireguard/ld-kafka.key

# Applies the rendered ruleset at boot, before the tunnel and Docker.
install -m 0644 /dev/stdin /etc/systemd/system/ld-kafka-firewall.service <<'EOF'
[Unit]
Description=LeadDrive Kafka host firewall
DefaultDependencies=no
Before=network-pre.target wg-quick@wg0.service docker.service
Wants=network-pre.target
ConditionPathExists=/etc/leaddrive-kafka/nftables.conf

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/leaddrive-kafka/nftables.conf

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

printf 'WG_PUBLIC_KEY=%s\n' "$(wg pubkey </etc/wireguard/ld-kafka.key)"
