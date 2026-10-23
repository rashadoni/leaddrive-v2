#!/usr/bin/env bash
# Disposable kernel-level drill of the rendered WireGuard mesh and nftables
# rules. Each mesh member is a network namespace with its own "public"
# address on a shared bridge; the files render.mjs produces for production are
# applied unchanged. Proves that overlay ports open only to the intended
# roles, that Kafka/PostgreSQL ports are closed on public addresses and to
# non-members, and that the production host keeps its public services.
#
# Run as root on a disposable runner with LD_KAFKA_DRILL_DISPOSABLE=1.
set -Eeuo pipefail
[ "${LD_KAFKA_DRILL_DISPOSABLE:-}" = 1 ] || { echo "refusing: disposable runners only" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
work="$(mktemp -d)"
members=(kafka-p-broker-eu kafka-p-ctrl-eu kafka-p-connect-eu leaddrive-prod)
fail() { printf 'NETWORK DRILL FAILED: %s\n' "$*" >&2; exit 1; }
ns() { echo "ldn-$1"; }

cleanup() {
  for m in "${members[@]}" outsider; do ip netns del "$(ns "$m")" 2>/dev/null || true; rm -rf "/etc/netns/$(ns "$m")"; done
  ip link del ldbr0 2>/dev/null || true
  pkill -f 'ldn-listener' 2>/dev/null || true
}
trap cleanup EXIT

ip link add ldbr0 type bridge && ip addr add 192.0.2.1/24 dev ldbr0 && ip link set ldbr0 up
i=10
declare -A public overlay
inventory='{"hosts":{'
for m in "${members[@]}" outsider; do
  n="$(ns "$m")"
  ip netns add "$n"
  ip link add "v-$i" type veth peer name eth0 netns "$n"
  ip link set "v-$i" master ldbr0 up
  ip -n "$n" addr add "192.0.2.$i/24" dev eth0
  ip -n "$n" link set eth0 up
  ip -n "$n" link set lo up
  public[$m]="192.0.2.$i"; overlay[$m]="10.88.0.$i"
  if [ "$m" != outsider ]; then
    mkdir -p "/etc/netns/$n/wireguard"
    wg genkey >"/etc/netns/$n/wireguard/ld-kafka.key"
    chmod 0600 "/etc/netns/$n/wireguard/ld-kafka.key"
    pub="$(wg pubkey <"/etc/netns/$n/wireguard/ld-kafka.key")"
    inventory+="\"$m\":{\"address\":\"10.88.0.$i\",\"publicAddress\":\"192.0.2.$i\",\"wgPublicKey\":\"$pub\"},"
  fi
  i=$((i + 1))
done
inventory="${inventory%,}}}"
printf '%s' "$inventory" >"$work/inventory.json"
node "$repo/scripts/event-platform/cluster/render.mjs" network --inventory "$work/inventory.json" --out "$work/net"

for m in "${members[@]}"; do
  n="$(ns "$m")"
  ip netns exec "$n" wg-quick up "$work/net/$m/wg0.conf" >/dev/null 2>&1 || fail "wg-quick up failed on $m"
  ip netns exec "$n" nft -f "$work/net/$m/nftables.conf" || fail "nftables rejected on $m"
done

listen() { # listen MEMBER PORT...
  for port in "${@:2}"; do
    ip netns exec "$(ns "$1")" bash -c "exec -a ldn-listener nc -lk $port >/dev/null 2>&1" &
  done
}
listen kafka-p-broker-eu 22 9092 9094 9100
listen kafka-p-ctrl-eu 22 9093
listen kafka-p-connect-eu 22 8083
listen leaddrive-prod 22 443 5432
sleep 2

# Let the tunnels handshake once.
for m in kafka-p-ctrl-eu kafka-p-connect-eu leaddrive-prod; do
  ip netns exec "$(ns "$m")" ping -c1 -W3 "${overlay[kafka-p-broker-eu]}" >/dev/null || fail "$m cannot reach the broker over the overlay"
done

check() { # check allow|deny FROM HOST PORT LABEL
  local want="$1" from="$2" to="$3" port="$4" label="$5" got=deny
  ip netns exec "$(ns "$from")" nc -z -w 3 "$to" "$port" >/dev/null 2>&1 && got=allow
  [ "$got" = "$want" ] || fail "$label: expected $want, got $got"
  printf '%-5s %s\n' "$want" "$label"
}
o() { echo "${overlay[$1]}"; }
p() { echo "${public[$1]}"; }
check allow kafka-p-connect-eu "$(o kafka-p-broker-eu)" 9092 "connect -> broker client listener (overlay)"
check allow leaddrive-prod     "$(o kafka-p-broker-eu)" 9092 "production app -> broker client listener (overlay)"
check allow kafka-p-broker-eu  "$(o kafka-p-ctrl-eu)"   9093 "broker -> controller (overlay)"
check allow kafka-p-connect-eu "$(o leaddrive-prod)"    5432 "connect -> PostgreSQL (overlay)"
check deny  kafka-p-connect-eu "$(o kafka-p-broker-eu)" 9094 "connect -> broker replication listener"
check deny  kafka-p-connect-eu "$(o kafka-p-ctrl-eu)"   9093 "connect -> controller"
check deny  kafka-p-ctrl-eu    "$(o kafka-p-broker-eu)" 9092 "controller -> broker client listener"
check deny  kafka-p-broker-eu  "$(o leaddrive-prod)"    5432 "broker -> PostgreSQL"
check deny  kafka-p-connect-eu "$(o kafka-p-broker-eu)" 9100 "non-monitoring host -> metrics"
check deny  kafka-p-connect-eu "$(p kafka-p-broker-eu)" 9092 "client listener on the public address"
check deny  outsider           "$(p kafka-p-broker-eu)" 9092 "outsider -> broker client port"
check deny  outsider           "$(p kafka-p-broker-eu)" 9094 "outsider -> broker replication port"
check deny  outsider           "$(p kafka-p-ctrl-eu)"   9093 "outsider -> controller port"
check deny  outsider           "$(p kafka-p-connect-eu)" 8083 "outsider -> Connect REST"
check deny  outsider           "$(p leaddrive-prod)"    5432 "outsider -> PostgreSQL"
check allow outsider           "$(p kafka-p-broker-eu)" 22   "SSH stays reachable for operators"
check allow outsider           "$(p leaddrive-prod)"    443  "production keeps its public HTTPS"
echo "NETWORK DRILL PASSED"
