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
#   provision.sh install-watch ENV          health probe on every host + the watch timer here
#   provision.sh install-backup-watch       the backup watch on BACKUP_WATCH_HOST (after install-watch)
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

backup_host() { node --input-type=module -e "import { BACKUP_WATCH_HOST } from '$here/watch.mjs'; console.log(BACKUP_WATCH_HOST)"; }

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
        function require_id() { for (;;) { const id = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url").slice(0, 22); if (!id.startsWith("-")) return id } }
        writeFileSync(file, JSON.stringify(inv, null, 2) + "\n")
      })' "$inventory" "$cluster"
    mapfile -t nodes < <(js '
      const c = m.loadTopology().clusters.find((x) => x.name === process.argv[1])
      for (const h of c.hosts) if (h.roles.includes("broker") || h.roles.includes("controller")) console.log(h.name)' "$cluster")
    for name in "${nodes[@]}"; do
      address="$(js 'const h = JSON.parse(process.argv[2]).hosts[process.argv[1]]; if (!h?.address) process.exit(1); console.log(h.address)' "$name" "$(cat "$inventory")")" || {
        # Controllers must all exist; a broker may join later.
        [[ ",$(member_role "$name")," == *",broker,"* ]] && { echo "skip certificate for pending $name"; continue; }
        die "$name has not been bootstrapped"
      }
      [ -d "$pki/issued/$name" ] || bash "$here/pki.sh" issue "$pki" "$name" "$name" "$address"
    done
    [ -d "$pki/issued/kafka-admin" ] || bash "$here/pki.sh" issue "$pki" kafka-admin kafka-admin
    js '
      import("node:fs").then(({ readFileSync, writeFileSync }) => {
        const [file, cluster, out] = process.argv.slice(1)
        const inv = JSON.parse(readFileSync(file, "utf8"))
        const c = m.loadTopology().clusters.find((x) => x.name === cluster)
        const pendingBrokers = c.hosts.filter((h) => h.roles.includes("broker") && !inv.hosts[h.name]?.address).map((h) => h.name)
        if (pendingBrokers.length) console.error(`brokers not delivered yet, left out: ${pendingBrokers.join(", ")}`)
        const files = m.renderCluster({ topology: m.loadTopology(), catalog: m.loadCatalog(), clusterName: cluster,
          inventory: { clusterId: inv.clusters[cluster].clusterId, hosts: inv.hosts }, pendingBrokers })
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
      console.log(c.hosts.filter((h) => h.roles.includes("broker") && inv.hosts[h.name]?.address).map((h) => `${inv.hosts[h.name].address}:${m.PORTS.replication}`).join(","))' "$cluster" "$(cat "$inventory")")"
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

  apply-catalog)
    # provision.sh apply-catalog CLUSTER ENV: topics (catalog + platform), SCRAM
    # identities and ACLs in one session on one broker. Idempotent. Service
    # passwords are generated once into $state/secrets (0600) and reused.
    cluster="${2:-}"; env="${3:-}"
    [[ "$env" =~ ^[a-z][a-z0-9]*$ ]] || die "ENV must match [a-z][a-z0-9]*"
    broker="$(js 'const c = m.loadTopology().clusters.find((x) => x.name === process.argv[1]); if (!c) process.exit(1); console.log(c.hosts.find((h) => h.roles.includes("broker")).name)' "$cluster")" \
      || die "unknown cluster $cluster"
    bootstrap="$(js '
      const [cluster, inv] = [process.argv[1], JSON.parse(process.argv[2])]
      const c = m.loadTopology().clusters.find((x) => x.name === cluster)
      console.log(c.hosts.filter((h) => h.roles.includes("broker") && inv.hosts[h.name]?.address).map((h) => `${inv.hosts[h.name].address}:${m.PORTS.replication}`).join(","))' "$cluster" "$(cat "$inventory")")"
    image="$(js 'console.log(m.KAFKA_IMAGE)')"
    mkdir -p "$state/secrets"
    bundle="$(mktemp -d)"; trap 'rm -rf "$bundle"' EXIT
    node --input-type=module -e "
      import { writeFileSync } from 'node:fs'
      import { expandCatalog, loadCatalog } from '$here/render.mjs'
      import { infraTopics, aclBindings, PRINCIPALS } from '$here/services.mjs'
      const env = process.argv[1], out = process.argv[2]
      const catalog = expandCatalog(loadCatalog(), env)
      const tsv = (t) => [t.name, t.partitions, t.replicationFactor, Object.entries(t.config).map(([k, v]) => k + '=' + v).join(',')].join('\t')
      writeFileSync(out + '/topics.tsv', [...catalog, ...infraTopics(env)].map(tsv).join('\n') + '\n')
      writeFileSync(out + '/acls.txt', aclBindings(env, catalog).map((a) => a.join(' ')).join('\n') + '\n')
      writeFileSync(out + '/users.txt', Object.values(PRINCIPALS).join('\n') + '\n')
    " "$env" "$bundle"
    : >"$bundle/scram.txt"
    while read -r user; do
      secret="$state/secrets/$env-$user"
      [ -s "$secret" ] || openssl rand -hex 24 >"$secret"
      chmod 0600 "$secret"
      printf '%s %s\n' "$user" "$(cat "$secret")" >>"$bundle/scram.txt"
    done <"$bundle/users.txt"
    admin_dir="$state/pki-$cluster/issued/kafka-admin"
    on "$broker" 'install -d -m 0700 /run/ld-kafka-admin'
    copy "$broker" 0600 root:root "$admin_dir/node.pem" /run/ld-kafka-admin/node.pem
    copy "$broker" 0644 root:root "$admin_dir/ca.pem" /run/ld-kafka-admin/ca.pem
    printf 'security.protocol=SSL\nssl.keystore.type=PEM\nssl.keystore.location=/client/node.pem\nssl.truststore.type=PEM\nssl.truststore.location=/client/ca.pem\n' \
      | on "$broker" 'install -m 0600 /dev/stdin /run/ld-kafka-admin/admin.properties'
    for f in topics.tsv acls.txt scram.txt; do copy "$broker" 0600 root:root "$bundle/$f" "/run/ld-kafka-admin/$f"; done
    copy "$broker" 0700 root:root "$here/apply-catalog-remote.sh" /run/ld-kafka-admin/apply.sh
    on "$broker" "trap 'rm -rf /run/ld-kafka-admin' EXIT; docker run --rm --network host --user 0 -v /run/ld-kafka-admin:/client:ro \
      -e KAFKA_HEAP_OPTS='-Xms64m -Xmx512m' --entrypoint /bin/bash $image /client/apply.sh $bootstrap"
    ;;

  push-services)
    # provision.sh push-services NAME ENV: Debezium Connect + Apicurio Registry
    # on a connect/registry host. Requires apply-catalog for ENV first (topics,
    # identities); secrets go only into 0600 *.secret.env files on the host.
    name="${2:-}"; env="${3:-}"
    cluster="$(js 'const c = m.loadTopology().clusters.find((x) => x.hosts.some((h) => h.name === process.argv[1] && h.roles.includes("connect"))); if (!c) process.exit(1); console.log(c.name)' "$name")" \
      || die "$name is not a connect/registry host"
    for user in ld-connect ld-registry; do [ -s "$state/secrets/$env-$user" ] || die "no $env-$user secret; run apply-catalog first"; done
    out="$(mktemp -d)"; trap 'rm -rf "$out"' EXIT
    node --input-type=module -e "
      import { readFileSync, writeFileSync } from 'node:fs'
      import { loadTopology } from '$here/render.mjs'
      import { renderServiceHost, connectSecretEnv, registrySecretEnv } from '$here/services.mjs'
      const [inventoryFile, cluster, env, name, dir, state] = process.argv.slice(1)
      const topology = loadTopology(), inv = JSON.parse(readFileSync(inventoryFile, 'utf8'))
      const src = inv.hosts[topology.sourceHost.name]
      const source = process.env.LD_WITH_SOURCE === '1' && src?.address
        ? { tlsName: topology.sourceHost.postgresTlsName, address: src.address } : undefined
      if (process.env.LD_WITH_SOURCE === '1' && !source) throw new Error('source host is not enrolled in the inventory')
      const files = renderServiceHost({ topology, inventory: inv, clusterName: cluster, envName: env, hostName: name, source })
      for (const [file, content] of Object.entries(files)) writeFileSync(dir + '/' + file, content)
      const secret = (u) => readFileSync(state + '/secrets/' + env + '-' + u, 'utf8').trim()
      writeFileSync(dir + '/connect.secret.env', connectSecretEnv(secret('ld-connect')), { mode: 0o600 })
      writeFileSync(dir + '/registry.secret.env', registrySecretEnv(secret('ld-registry')), { mode: 0o600 })
    " "$inventory" "$cluster" "$env" "$name" "$out" "$state"
    on "$name" 'install -d -m 0750 /etc/leaddrive-kafka/services'
    for f in compose.yml connect.env registry.env; do copy "$name" 0644 root:root "$out/$f" "/etc/leaddrive-kafka/services/$f"; done
    for f in connect.secret.env registry.secret.env; do copy "$name" 0600 root:root "$out/$f" "/etc/leaddrive-kafka/services/$f"; done
    copy "$name" 0644 root:root "$state/pki-$cluster/ca.pem" /etc/leaddrive-kafka/tls/ca.pem
    on "$name" 'docker compose -f /etc/leaddrive-kafka/services/compose.yml up -d --remove-orphans'
    echo "pushed services to $name"
    ;;

  enroll-source)
    # provision.sh enroll-source PHASE [PUBLIC_IP]: drive source-enroll.sh on the
    # production web/PostgreSQL host. Phases: prepare PUBLIC_IP | network |
    # postgres-config | restart | cdc-role | status. Only with the owner's window.
    phase="${2:-}"
    src_key="${LD_SOURCE_SSH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
    src_name="$(js 'console.log(m.loadTopology().sourceHost.name)')"
    if [ "$phase" = prepare ]; then
      ip="${3:-}"; [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "prepare needs the source PUBLIC_IP"
    else
      ip="$(public_of "$src_name")" || die "source not enrolled; run prepare first"
    fi
    on_src() { ssh -i "$src_key" -o IdentitiesOnly=yes -o ControlMaster=no -o ControlPath=none -o BatchMode=yes -o ConnectTimeout=15 "root@$ip" "$@"; }
    on_src 'install -d -m 0700 /root/ld-source-enroll'
    on_src 'install -m 0700 /dev/stdin /root/ld-source-enroll/source-enroll.sh' <"$here/source-enroll.sh"
    overlay_env() {
      js '
        const inv = JSON.parse(process.argv[1]); const t = m.loadTopology()
        const connect = t.clusters.flatMap((c) => c.hosts).filter((h) => h.roles.includes("connect") && inv.hosts[h.name]?.address)
        console.log(`OVERLAY_ADDR=${inv.hosts[t.sourceHost.name].address} CONNECT_ADDRS=${connect.map((h) => inv.hosts[h.name].address).join(",")} DBNAME=${t.sourceHost.database}`)' "$(cat "$inventory")"
    }
    case "$phase" in
      prepare)
        out="$(on_src 'bash /root/ld-source-enroll/source-enroll.sh prepare')"
        key="$(grep -E '^WG_PUBLIC_KEY=' <<<"$out" | tail -1 | cut -d= -f2-)"
        [[ "$key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "prepare did not report a WireGuard key"
        js '
          import("node:fs").then(({ readFileSync, writeFileSync }) => {
            const [file, ip, key] = process.argv.slice(1)
            const inv = JSON.parse(readFileSync(file, "utf8")); const t = m.loadTopology()
            const index = m.meshMembers(t).findIndex((x) => x.name === t.sourceHost.name)
            inv.hosts[t.sourceHost.name] = { address: `10.88.0.${10 + index}`, publicAddress: ip, wgPublicKey: key }
            writeFileSync(file, JSON.stringify(inv, null, 2) + "\n")
          })' "$inventory" "$ip" "$key"
        echo "source prepared; tunnel key recorded" ;;
      network)
        node "$here/render.mjs" network --inventory "$inventory" --out "$state/rendered/network" >/dev/null
        net="$state/rendered/network/$src_name"
        on_src 'install -d -m 0700 /root/ld-source-enroll/net'
        for f in wg0.conf nftables.conf ufw.sh; do on_src "install -m 0600 /dev/stdin /root/ld-source-enroll/net/$f" <"$net/$f"; done
        on_src 'bash /root/ld-source-enroll/source-enroll.sh network /root/ld-source-enroll/net'
        # Every Kafka host learns the new peer and its firewall rules.
        mapfile -t members < <(js '
          const inv = JSON.parse(process.argv[1]); const t = m.loadTopology()
          for (const h of m.meshMembers(t)) if (inv.hosts[h.name] && h.name !== t.sourceHost.name) console.log(h.name)' "$(cat "$inventory")")
        for name in "${members[@]}"; do "$0" push "$name" | tail -1; sleep 10; done ;;
      postgres-config|restart|status)
        on_src "$(overlay_env) bash /root/ld-source-enroll/source-enroll.sh $phase" ;;
      cdc-role)
        secret="$state/secrets/prod-leaddrive_event_cdc"
        [ -s "$secret" ] || { mkdir -p "$state/secrets"; openssl rand -hex 24 >"$secret"; chmod 0600 "$secret"; }
        on_src 'install -m 0600 /dev/stdin /root/ld-source-enroll/prepare-cdc.sql' <"$repo/ops/event-platform/postgres/prepare-cdc.sql"
        on_src "$(overlay_env) REPO_SQL=/root/ld-source-enroll/prepare-cdc.sql bash /root/ld-source-enroll/source-enroll.sh cdc-role" <"$secret" ;;
      *) die "unknown phase $phase" ;;
    esac
    ;;

  register-connector)
    # provision.sh register-connector ENV: give both Connect hosts the source
    # certificate, the CDC password file and the source host mapping, then
    # create or update the outbox connector through the first Connect host.
    env="${2:-}"
    src_name="$(js 'console.log(m.loadTopology().sourceHost.name)')"
    src_ip="$(public_of "$src_name")" || die "source not enrolled"
    src_key="${LD_SOURCE_SSH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
    secret="$state/secrets/prod-leaddrive_event_cdc"; [ -s "$secret" ] || die "no CDC password; run enroll-source cdc-role"
    cert="$(mktemp)"; ssh -i "$src_key" -o IdentitiesOnly=yes -o ControlMaster=no -o ControlPath=none -o BatchMode=yes "root@$src_ip" \
      'cat "$(sudo -u postgres psql -XAtc "show ssl_cert_file")"' >"$cert"
    openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die "could not read the source server certificate"
    mapfile -t connect_hosts < <(js '
      const inv = JSON.parse(process.argv[1])
      for (const c of m.loadTopology().clusters) for (const h of c.hosts) if (h.roles.includes("connect") && inv.hosts[h.name]?.address) console.log(h.name)' "$(cat "$inventory")")
    for name in "${connect_hosts[@]}"; do
      copy "$name" 0644 root:root "$cert" /etc/leaddrive-kafka/tls/source-postgres.pem
      on "$name" 'install -d -m 0700 /etc/leaddrive-kafka/services/secrets'
      printf 'password=%s\n' "$(cat "$secret")" | on "$name" 'install -m 0644 /dev/stdin /etc/leaddrive-kafka/services/secrets/cdc.properties'
      LD_WITH_SOURCE=1 "$0" push-services "$name" "$env" | tail -1
    done
    rm -f "$cert"
    first="${connect_hosts[0]}"
    rest="$(js 'console.log(JSON.parse(process.argv[2]).hosts[process.argv[1]].address)' "$first" "$(cat "$inventory")")"
    node --input-type=module -e "
      import { readFileSync } from 'node:fs'
      import { loadTopology } from '$here/render.mjs'
      import { renderSourceConnector } from '$here/services.mjs'
      const t = loadTopology()
      const c = renderSourceConnector({ template: JSON.parse(readFileSync('$repo/ops/event-platform/debezium/event-outbox-connector.template.json', 'utf8')),
        envName: '$env', source: { tlsName: t.sourceHost.postgresTlsName, dbname: t.sourceHost.database } })
      process.stdout.write(JSON.stringify(c.config))
    " | on "$first" "for i in \$(seq 30); do curl -fsS -m 5 http://$rest:8083/ >/dev/null && break; sleep 3; done
      curl -fsS -X PUT -H 'Content-Type: application/json' --data @- http://$rest:8083/connectors/leaddrive-event-outbox-$env/config >/dev/null
      sleep 15; curl -fsS http://$rest:8083/connectors/leaddrive-event-outbox-$env/status"
    echo
    ;;

  install-watch)
    # provision.sh install-watch ENV: the read-only probe on every host behind a
    # forced-command key, then the watch timer on this workstation. Idempotent;
    # rerun after changing health*.mjs, watch.mjs or the topology.
    env="${2:-}"; [[ "$env" =~ ^[a-z][a-z0-9]*$ ]] || die "usage: install-watch ENV"
    watch_key="${LD_KAFKA_WATCH_KEY:-$HOME/.ssh/leaddrive_kafka_watch}"
    [ -f "$watch_key" ] || ssh-keygen -q -t ed25519 -N '' -C ld-kafka-watch -f "$watch_key"
    pub="$(cut -d' ' -f1,2 "$watch_key.pub")"
    src_key="${LD_SOURCE_SSH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
    src_name="$(js 'console.log(m.loadTopology().sourceHost.name)')"
    mapfile -t members < <(js '
      const inv = JSON.parse(process.argv[1]); const t = m.loadTopology()
      const primary = t.clusters.find((c) => c.name === "primary")
      for (const h of [...primary.hosts, { name: t.sourceHost.name, roles: ["source"] }]) if (inv.hosts[h.name]?.publicAddress) console.log(h.name, h.roles.join(","))' "$(cat "$inventory")")
    for line in "${members[@]}"; do
      read -r name roles <<<"$line"
      if [ "$name" = "$src_name" ]; then
        ip="$(public_of "$name")"
        # The watch checks host keys against the operator's known_hosts only;
        # the production key comes from the one this workstation already trusts.
        ssh-keygen -F "$ip" -f "$state/known_hosts" >/dev/null || ssh-keygen -F "$ip" | grep -v '^#' >>"$state/known_hosts" || true
        ssh-keygen -F "$ip" -f "$state/known_hosts" >/dev/null || die "no trusted host key for $name ($ip)"
        run_on() { ssh -i "$src_key" -o IdentitiesOnly=yes -o ControlMaster=no -o ControlPath=none -o BatchMode=yes -o ConnectTimeout=15 "root@$ip" "$@"; }
        config="$(js 'const t = m.loadTopology(); console.log(JSON.stringify({ expectedSlot: `leaddrive_event_outbox_${process.argv[1]}`, database: t.sourceHost.database }))' "$env")"
      else
        run_on() { on "$name" "$@"; }
        config="$(js 'console.log(JSON.stringify({ expectedConnectors: process.argv[2].split(",").includes("connect") ? [`leaddrive-event-outbox-${process.argv[1]}`] : [],
          backupWatch: process.argv[3] === process.argv[4], eventTopicPrefix: `ld.${process.argv[1]}.` }))' "$env" "$roles" "$name" "$(backup_host)")"
      fi
      run_on 'install -m 0755 -o root -g root /dev/stdin /usr/local/sbin/ld-kafka-health' <"$here/health-probe.py"
      printf '%s\n' "$config" | run_on 'install -d -m 0755 /etc/leaddrive-kafka && install -m 0644 /dev/stdin /etc/leaddrive-kafka/health.json'
      entry="restrict,command=\"/usr/local/sbin/ld-kafka-health $roles\" $pub ld-kafka-watch"
      printf '%s\n' "$entry" | run_on 'install -d -m 0700 /root/.ssh; touch /root/.ssh/authorized_keys
        { grep -v " ld-kafka-watch$" /root/.ssh/authorized_keys; cat; } >/root/.ssh/authorized_keys.new
        chmod 0600 /root/.ssh/authorized_keys.new && mv /root/.ssh/authorized_keys.new /root/.ssh/authorized_keys'
      echo "probe on $name ($roles)"
    done
    # The watch runs from its own copy, so a removed worktree cannot stop it.
    dest="$HOME/.local/share/ld-kafka-watch"
    for f in scripts/event-platform/cluster/watch.mjs scripts/event-platform/cluster/health.mjs scripts/event-platform/cluster/render.mjs \
             ops/event-platform/topology.v1.json ops/event-platform/topics.v1.json; do
      install -D -m 0644 "$repo/$f" "$dest/$f"
    done
    units="$HOME/.config/systemd/user"; mkdir -p "$units"
    for unit in ld-kafka-watch.service ld-kafka-watch.timer ld-kafka-watch-failed.service; do
      sed -e "s|@NODE@|$(command -v node)|g" -e "s|@WATCH@|$dest/scripts/event-platform/cluster/watch.mjs|g" \
        "$repo/ops/event-platform/watch/$unit" >"$units/$unit"
    done
    systemctl --user daemon-reload
    systemctl --user enable --now ld-kafka-watch.timer >/dev/null
    echo "watch timer: $(systemctl --user is-active ld-kafka-watch.timer)"
    ;;

  install-backup-watch)
    # The same watch.mjs on a host outside this workstation's provider, as root
    # under systemd. It reads the operator's inventory and known_hosts and uses
    # a copy of the watch key (forced read-only commands only), so it can probe
    # production too. Idempotent; rerun after install-watch or a watch change.
    name="$(backup_host)"
    watch_key="${LD_KAFKA_WATCH_KEY:-$HOME/.ssh/leaddrive_kafka_watch}"
    notify_env="${LD_KAFKA_NOTIFY_ENV:-$HOME/.config/hetzner-task-notify.env}"
    [ -f "$watch_key" ] || die "run install-watch first: no watch key $watch_key"
    [ -r "$notify_env" ] || die "no Telegram settings at $notify_env"
    on "$name" 'command -v node >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends nodejs >/dev/null
      install -d -m 0700 /etc/leaddrive-kafka/watch /var/lib/ld-kafka-watch /var/lib/ld-kafka-watch/state
      node -e "process.exit(Number(process.versions.node.split(\".\")[0]) >= 18 ? 0 : 1)"' || die "no Node.js 18+ on $name"
    for f in scripts/event-platform/cluster/watch.mjs scripts/event-platform/cluster/health.mjs scripts/event-platform/cluster/render.mjs \
             ops/event-platform/topology.v1.json ops/event-platform/topics.v1.json; do
      on "$name" "install -D -m 0644 /dev/stdin /opt/ld-kafka-watch/$f" <"$repo/$f"
    done
    copy "$name" 0600 root:root "$watch_key" /etc/leaddrive-kafka/watch/key
    copy "$name" 0600 root:root "$inventory" /etc/leaddrive-kafka/watch/inventory.json
    copy "$name" 0600 root:root "$state/known_hosts" /etc/leaddrive-kafka/watch/known_hosts
    grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$notify_env" >"$state/.notify.tmp"
    copy "$name" 0600 root:root "$state/.notify.tmp" /etc/leaddrive-kafka/watch-notify.env; rm -f "$state/.notify.tmp"
    copy "$name" 0755 root:root "$repo/ops/event-platform/watch/notify-telegram.sh" /usr/local/sbin/ld-kafka-notify
    for unit in ld-kafka-backup-watch.service ld-kafka-backup-watch.timer ld-kafka-backup-watch-failed.service; do
      copy "$name" 0644 root:root "$repo/ops/event-platform/watch/$unit" "/etc/systemd/system/$unit"
    done
    on "$name" 'systemctl daemon-reload && systemctl enable --now ld-kafka-backup-watch.timer >/dev/null && systemctl is-active ld-kafka-backup-watch.timer' \
      | sed "s/^/backup watch timer on $name: /"
    ;;

  verify)
    status=0
    while read -r name roles; do
      [[ ",$roles," == *",source,"* ]] && continue
      ip="$(public_of "$name")" || { echo "skip $name (not bootstrapped)"; continue; }
      for port in 9092 9093 9094 8080 8083 5432; do
        if timeout 4 bash -c ">/dev/tcp/$ip/$port" 2>/dev/null; then echo "OPEN on public address: $name $ip:$port"; status=1; fi
      done
      # </dev/null: ssh would otherwise swallow the rest of this loop's input.
      handshakes="$(on "$name" </dev/null 'now=$(date +%s); wg show wg0 latest-handshakes | awk -v now="$now" "{ if (\$2 == 0 || now - \$2 > 180) stale++ } END { print NR, stale + 0 }"')" \
        || { echo "tunnel down on $name"; status=1; continue; }
      echo "$name: public Kafka ports closed; tunnel peers/stale: $handshakes"
    done < <(js '
      const inv = JSON.parse(process.argv[1])
      for (const h of m.meshMembers(m.loadTopology())) if (inv.hosts[h.name]) console.log(h.name, h.roles.join(","))' "$(cat "$inventory")")
    exit "$status"
    ;;

  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
