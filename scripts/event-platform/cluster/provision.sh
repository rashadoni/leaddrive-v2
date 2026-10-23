#!/usr/bin/env bash
# Operator workflow for the real Kafka hosts. Runs on the operator workstation;
# keeps all state (inventory with public addresses, CA, rendered files) under
# $LD_KAFKA_STATE, never in Git.
#
#   provision.sh bootstrap NAME PUBLIC_IP   prepare a new host, record its tunnel key
#   provision.sh render CLUSTER             CA/certs as needed, render node + network files
#   provision.sh push NAME                  install firewall, tunnel, certs and Kafka on NAME
#   provision.sh verify                     public ports closed, tunnels up, quorum healthy
#   provision.sh admin BROKER TOOL ARGS...  run a Kafka admin tool over mTLS from BROKER
#   provision.sh topics CLUSTER ENV         create the governed catalog (idempotent)
#
# The production web host is not handled here; its tunnel/ufw step is separate.
set -Eeuo pipefail
umask 077

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
here="$repo/scripts/event-platform/cluster"
state="${LD_KAFKA_STATE:-$HOME/.leaddrive-kafka}"
ssh_key="${LD_KAFKA_SSH_KEY:-$HOME/.ssh/leaddrive_kafka_ops}"
inventory="$state/inventory.json"
die() { printf 'provision: %s\n' "$*" >&2; exit 1; }
js() { node --input-type=module -e "import * as m from '$here/render.mjs'; $1" "${@:2}"; }

mkdir -p "$state"
[ -f "$inventory" ] || printf '{"clusters":{},"hosts":{}}\n' >"$inventory"
[ -f "$ssh_key" ] || die "operator SSH key $ssh_key is missing"

ssh_opts=(-i "$ssh_key" -o IdentitiesOnly=yes -o ControlMaster=no -o ControlPath=none
  -o UserKnownHostsFile="$state/known_hosts" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
public_of() { js 'const i = JSON.parse(process.argv[2]).hosts[process.argv[1]]; if (!i?.publicAddress) process.exit(1); console.log(i.publicAddress)' "$1" "$(cat "$inventory")"; }
on() { local name="$1"; shift; ssh "${ssh_opts[@]}" "root@$(public_of "$name")" "$@"; }
copy() { local name="$1" mode="$2" owner="$3" src="$4" dst="$5"
  on "$name" "install -m $mode -o ${owner%:*} -g ${owner#*:} /dev/stdin '$dst'" <"$src"; }

member_role() { js '
  const t = m.loadTopology(); const h = m.meshMembers(t).find((x) => x.name === process.argv[1])
  if (!h) process.exit(1); console.log(h.roles.join(","))' "$1"; }

case "${1:-}" in
  bootstrap)
    name="${2:-}"; ip="${3:-}"
    roles="$(member_role "$name")" || die "$name is not in topology.v1.json"
    [[ ",$roles," != *",source,"* ]] || die "the production host is not bootstrapped here"
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "PUBLIC_IP must be an IPv4 address"
    uid="$(js 'console.log(m.KAFKA_UID)')"
    out="$(ssh "${ssh_opts[@]}" "root@$ip" "KAFKA_UID=$uid bash -s" <"$here/host-bootstrap.sh")"
    key="$(grep -E '^WG_PUBLIC_KEY=' <<<"$out" | tail -1 | cut -d= -f2-)"
    [[ "$key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "bootstrap did not report a WireGuard key"
    js '
      import("node:fs").then(({ readFileSync, writeFileSync }) => {
        const [file, name, ip, key] = process.argv.slice(1)
        const inv = JSON.parse(readFileSync(file, "utf8"))
        const members = m.meshMembers(m.loadTopology())
        const index = members.findIndex((x) => x.name === name)
        inv.hosts[name] = { ...inv.hosts[name], address: `10.88.0.${10 + index}`, publicAddress: ip, wgPublicKey: key }
        writeFileSync(file, JSON.stringify(inv, null, 2) + "\n")
      })' "$inventory" "$name" "$ip" "$key"
    echo "bootstrapped $name ($ip), tunnel key recorded"
    ;;

  render)
    cluster="${2:-}"
    js 'const c = m.loadTopology().clusters.find((x) => x.name === process.argv[1]); if (!c) process.exit(1)' "$cluster" \
      || die "unknown cluster $cluster"
    pki="$state/pki-$cluster"
    [ -f "$pki/ca.key" ] || bash "$here/pki.sh" init "$pki"
    js '
      import("node:fs").then(({ readFileSync, writeFileSync }) => {
        const [file, cluster] = process.argv.slice(1)
        const inv = JSON.parse(readFileSync(file, "utf8"))
        inv.clusters[cluster] ??= { clusterId: require_id() }
        function require_id() { return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url").slice(0, 22) }
        writeFileSync(file, JSON.stringify(inv, null, 2) + "\n")
      })' "$inventory" "$cluster"
    mapfile -t nodes < <(js '
      const c = m.loadTopology().clusters.find((x) => x.name === process.argv[1])
      for (const h of c.hosts) if (h.roles.includes("broker") || h.roles.includes("controller")) console.log(h.name)' "$cluster")
    for name in "${nodes[@]}"; do
      address="$(js 'const h = JSON.parse(process.argv[2]).hosts[process.argv[1]]; if (!h?.address) process.exit(1); console.log(h.address)' "$name" "$(cat "$inventory")")" \
        || die "$name has not been bootstrapped"
      [ -d "$pki/issued/$name" ] || bash "$here/pki.sh" issue "$pki" "$name" "$name" "$address"
    done
    [ -d "$pki/issued/kafka-admin" ] || bash "$here/pki.sh" issue "$pki" kafka-admin kafka-admin
    js '
      import("node:fs").then(({ readFileSync, writeFileSync }) => {
        const [file, cluster, out] = process.argv.slice(1)
        const inv = JSON.parse(readFileSync(file, "utf8"))
        const files = m.renderCluster({ topology: m.loadTopology(), catalog: m.loadCatalog(), clusterName: cluster,
          inventory: { clusterId: inv.clusters[cluster].clusterId, hosts: inv.hosts } })
        writeFileSync(out, JSON.stringify(files))
      })' "$inventory" "$cluster" "$state/rendered-$cluster.json"
    rm -rf "$state/rendered/$cluster"; mkdir -p "$state/rendered/$cluster"
    js '
      import("node:fs").then(({ readFileSync, writeFileSync, mkdirSync }) => {
        const [json, dir] = process.argv.slice(1)
        for (const [rel, content] of Object.entries(JSON.parse(readFileSync(json, "utf8")))) {
          mkdirSync(`${dir}/${rel.split("/")[0]}`, { recursive: true }); writeFileSync(`${dir}/${rel}`, content)
        }
      })' "$state/rendered-$cluster.json" "$state/rendered/$cluster"
    node "$here/render.mjs" network --inventory "$inventory" --out "$state/rendered/network"
    echo "rendered $cluster into $state/rendered"
    ;;

  push)
    name="${2:-}"
    roles="$(member_role "$name")" || die "$name is not in topology.v1.json"
    [[ ",$roles," != *",source,"* ]] || die "the production host is not pushed here"
    net="$state/rendered/network/$name"
    [ -f "$net/wg0.conf" ] && [ -f "$net/nftables.conf" ] || die "render first: no network files for $name"
    on "$name" "nft -c -f /dev/stdin" <"$net/nftables.conf" || die "nftables ruleset rejected on $name"
    copy "$name" 0600 root:root "$net/nftables.conf" /etc/leaddrive-kafka/nftables.conf
    copy "$name" 0600 root:root "$net/wg0.conf" /etc/wireguard/wg0.conf
    # Restart rather than syncconf: the rendered file has no PrivateKey line,
    # which setconf/syncconf would apply as "remove the key".
    on "$name" 'systemctl enable --now ld-kafka-firewall >/dev/null && nft -f /etc/leaddrive-kafka/nftables.conf &&
      systemctl enable wg-quick@wg0 >/dev/null && systemctl restart wg-quick@wg0'
    for cluster_dir in "$state"/rendered/*/; do
      [ -f "$cluster_dir/$name/server.properties" ] || continue
      cluster="$(basename "$cluster_dir")"
      pki="$state/pki-$cluster/issued/$name"
      copy "$name" 0644 root:root "$cluster_dir/$name/server.properties" /etc/leaddrive-kafka/server.properties
      copy "$name" 0644 root:root "$cluster_dir/$name/kafka.env" /etc/leaddrive-kafka/kafka.env
      copy "$name" 0644 root:root "$cluster_dir/$name/compose.yml" /etc/leaddrive-kafka/compose.yml
      copy "$name" 0640 root:ld-kafka "$pki/node.pem" /etc/leaddrive-kafka/tls/node.pem
      copy "$name" 0644 root:root "$pki/ca.pem" /etc/leaddrive-kafka/tls/ca.pem
      on "$name" 'docker compose -f /etc/leaddrive-kafka/compose.yml up -d --remove-orphans'
    done
    echo "pushed $name"
    ;;

  admin)
    broker="${2:-}"; tool="${3:-}"; shift 3 || die "usage: admin BROKER TOOL ARGS..."
    [[ "$tool" =~ ^kafka-[a-z-]+\.sh$ ]] || die "TOOL must be a kafka-*.sh tool name"
    cluster="$(js 'const t = m.loadTopology(); const c = t.clusters.find((x) => x.hosts.some((h) => h.name === process.argv[1] && h.roles.includes("broker"))); if (!c) process.exit(1); console.log(c.name)' "$broker")" \
      || die "$broker is not a broker"
    bootstrap="$(js '
      const [cluster, inv] = [process.argv[1], JSON.parse(process.argv[2])]
      const c = m.loadTopology().clusters.find((x) => x.name === cluster)
      console.log(c.hosts.filter((h) => h.roles.includes("broker")).map((h) => `${inv.hosts[h.name].address}:${m.PORTS.replication}`).join(","))' "$cluster" "$(cat "$inventory")")"
    image="$(js 'console.log(m.KAFKA_IMAGE)')"
    admin_dir="$state/pki-$cluster/issued/kafka-admin"
    # The admin key exists on the broker only for this command, in tmpfs.
    on "$broker" 'install -d -m 0700 /run/ld-kafka-admin'
    copy "$broker" 0600 root:root "$admin_dir/node.pem" /run/ld-kafka-admin/node.pem
    copy "$broker" 0644 root:root "$admin_dir/ca.pem" /run/ld-kafka-admin/ca.pem
    printf 'security.protocol=SSL\nssl.keystore.type=PEM\nssl.keystore.location=/client/node.pem\nssl.truststore.type=PEM\nssl.truststore.location=/client/ca.pem\n' \
      | on "$broker" 'install -m 0600 /dev/stdin /run/ld-kafka-admin/admin.properties'
    status=0
    on "$broker" "trap 'rm -rf /run/ld-kafka-admin' EXIT; docker run --rm -i --network host --user 0 -v /run/ld-kafka-admin:/client:ro \
      -e KAFKA_HEAP_OPTS='-Xms64m -Xmx256m' --entrypoint /opt/kafka/bin/$tool $image \
      --bootstrap-server $bootstrap --command-config /client/admin.properties $(printf '%q ' "$@")" || status=$?
    exit "$status"
    ;;

  topics)
    cluster="${2:-}"; env="${3:-}"
    broker="$(js 'const c = m.loadTopology().clusters.find((x) => x.name === process.argv[1]); console.log(c.hosts.find((h) => h.roles.includes("broker")).name)' "$cluster")"
    while IFS=$'\t' read -r name partitions rf config; do
      args=(--create --if-not-exists --topic "$name" --partitions "$partitions" --replication-factor "$rf")
      IFS=, read -ra kv <<<"$config"; for c in "${kv[@]}"; do args+=(--config "$c"); done
      "$0" admin "$broker" kafka-topics.sh "${args[@]}" >/dev/null
      echo "topic $name"
    done < <(node "$here/render.mjs" topics "$env")
    ;;

  verify)
    status=0
    while read -r name roles; do
      [[ ",$roles," == *",source,"* ]] && continue
      ip="$(public_of "$name")" || { echo "skip $name (not bootstrapped)"; continue; }
      for port in 9092 9093 9094 8080 8083 5432; do
        if timeout 4 bash -c ">/dev/tcp/$ip/$port" 2>/dev/null; then echo "OPEN on public address: $name $ip:$port"; status=1; fi
      done
      handshakes="$(on "$name" 'now=$(date +%s); wg show wg0 latest-handshakes | awk -v now="$now" "{ if (\$2 == 0 || now - \$2 > 180) stale++ } END { print NR, stale + 0 }"')" \
        || { echo "tunnel down on $name"; status=1; continue; }
      echo "$name: public Kafka ports closed; tunnel peers/stale: $handshakes"
    done < <(js '
      const inv = JSON.parse(process.argv[1])
      for (const h of m.meshMembers(m.loadTopology())) if (inv.hosts[h.name]) console.log(h.name, h.roles.join(","))' "$(cat "$inventory")")
    exit "$status"
    ;;

  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
