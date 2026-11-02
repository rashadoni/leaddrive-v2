#!/usr/bin/env node
// Render per-host Kafka configuration for one cluster of
// ops/event-platform/topology.v1.json.
//
// The output is the exact configuration both the disposable CI drill and the
// real hosts run: the drill only swaps overlay addresses for container names
// and shrinks heaps. Nothing here holds a secret. Brokers and controllers
// authenticate each other with mutual TLS (certificate CN = host name);
// application clients use SCRAM-SHA-512 over TLS on a separate listener.
//
// usage: render.mjs --cluster primary --inventory inventory.json --out DIR [--heap-scale 0.125]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))

export const KAFKA_IMAGE = 'apache/kafka:4.3.1@sha256:ccd1314e47ec76909e01f86308b4dcf2064f19f7c89759234322314b0e319e26'
export const PORTS = { client: 9092, controller: 9093, replication: 9094 }
export const ADMIN_PRINCIPAL = 'kafka-admin'
// Kafka runs as a dedicated uid that no login account on the host has (cloud
// images give uid 1000 to their default user). It owns only the data tree.
export const KAFKA_UID = 10001
// Broker heap by plan RAM (12 GB -> 4 GB, 8 GB -> 3 GB, 4 GB -> 1.5 GB); the
// rest of the host is page cache. Controllers keep only metadata and get 1 GB.
// VPS-1 is a stopgap broker until OVHcloud has VPS-2 stock in Europe again.
const BROKER_HEAP_MB = { 'Cloud VPS 6': 4096, 'Cloud VPS 4': 3072, 'VPS-2': 3072, 'VPS-1': 1536 }
const CONTROLLER_HEAP_MB = 1024

export function loadTopology() {
  return JSON.parse(readFileSync(path.join(root, 'ops/event-platform/topology.v1.json'), 'utf8'))
}

export function loadCatalog() {
  return JSON.parse(readFileSync(path.join(root, 'ops/event-platform/topics.v1.json'), 'utf8'))
}

// Every physical topic of the catalog for one environment, with the configs
// the broker must report back after creation.
export function expandCatalog(catalog, env) {
  if (!/^[a-z][a-z0-9]*$/.test(env)) throw new Error(`environment slug must match [a-z][a-z0-9]*: ${env}`)
  const topics = []
  for (const domain of catalog.domains) {
    for (const family of catalog.topicFamilies) {
      const partitions = family.partitionsFromDomain ? domain.partitions : family.partitions
      const retention = family.retentionMsFromDomain ? domain.eventRetentionMs : family.retentionMs
      topics.push({
        name: family.nameTemplate.replace('<env>', env).replace('<domain>', domain.name),
        partitions,
        replicationFactor: catalog.defaults.replicationFactor,
        config: { ...catalog.defaults.config, ...family.config, 'retention.ms': String(retention) },
      })
    }
  }
  for (const topic of catalog.controlTopics) {
    topics.push({
      name: topic.name.replace('<env>', env),
      partitions: topic.partitions,
      replicationFactor: topic.replicationFactor,
      config: { ...catalog.defaults.config, ...topic.config },
    })
  }
  return topics
}

// Stable KRaft node ids: controllers 1..n, brokers 101.. in topology order.
export function nodeIds(cluster) {
  const ids = new Map()
  let controller = 1
  let broker = 101
  for (const host of cluster.hosts) {
    if (host.roles.includes('controller')) ids.set(host.name, controller++)
    else if (host.roles.includes('broker')) ids.set(host.name, broker++)
  }
  return ids
}

export function addressOf(inventory, name) {
  const address = inventory.hosts?.[name]?.address
  if (typeof address !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(address)) {
    throw new Error(`inventory has no usable address for ${name}`)
  }
  return address
}

function properties(entries) {
  return `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`
}

function commonSecurity(superUsers) {
  return [
    ['ssl.keystore.type', 'PEM'],
    ['ssl.keystore.location', '/etc/kafka/tls/node.pem'],
    ['ssl.truststore.type', 'PEM'],
    ['ssl.truststore.location', '/etc/kafka/tls/ca.pem'],
    ['ssl.endpoint.identification.algorithm', 'https'],
    ['ssl.enabled.protocols', 'TLSv1.3'],
    ['ssl.principal.mapping.rules', 'RULE:^CN=([a-z0-9-]+)$/$1/,DEFAULT'],
    ['authorizer.class.name', 'org.apache.kafka.metadata.authorizer.StandardAuthorizer'],
    ['allow.everyone.if.no.acl.found', 'false'],
    ['super.users', superUsers.map((name) => `User:${name}`).join(';')],
  ]
}

// pendingBrokers: brokers not delivered yet. They are skipped (and can join
// later with their own node id); controllers are never optional because the
// quorum voter set is fixed at format time.
export function renderCluster({ topology, catalog, clusterName, inventory, heapScale = 1, pendingBrokers = [] }) {
  const cluster = topology.clusters.find((c) => c.name === clusterName)
  if (!cluster) throw new Error(`unknown cluster ${clusterName}`)
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{21}$/.test(inventory.clusterId ?? '')) throw new Error('inventory.clusterId must be a 22-character Kafka cluster id not starting with "-"')
  const ids = nodeIds(cluster)
  const controllers = cluster.hosts.filter((h) => h.roles.includes('controller'))
  const brokers = cluster.hosts.filter((h) => h.roles.includes('broker'))
  const voters = controllers.map((h) => `${ids.get(h.name)}@${addressOf(inventory, h.name)}:${PORTS.controller}`).join(',')
  const superUsers = [...controllers, ...brokers].map((h) => h.name).concat(ADMIN_PRINCIPAL)
  const rf = String(catalog.defaults.replicationFactor)
  const minIsr = catalog.defaults.config['min.insync.replicas']
  const files = {}

  for (const name of pendingBrokers) {
    if (!brokers.some((h) => h.name === name)) throw new Error(`${name} is not a broker of ${clusterName}; only brokers may be pending`)
  }
  for (const host of [...controllers, ...brokers.filter((h) => !pendingBrokers.includes(h.name))]) {
    const address = addressOf(inventory, host.name)
    const isController = host.roles.includes('controller')
    const planHeap = isController ? CONTROLLER_HEAP_MB : BROKER_HEAP_MB[host.plan]
    if (!planHeap) throw new Error(`${host.name}: no broker heap defined for plan ${host.plan}`)
    // A broker below 512 MB falls out of ISR under the full catalog (drill
    // 39979802272: a 256 MB broker lagged, and one site loss then left
    // partitions with a single in-sync replica).
    const heap = Math.max(isController ? 256 : 512, Math.round((planHeap * heapScale) / 64) * 64)
    const entries = [
      ['process.roles', isController ? 'controller' : 'broker'],
      ['node.id', ids.get(host.name)],
      ['controller.quorum.voters', voters],
      ['controller.listener.names', 'CONTROLLER'],
      // The quorum spans Contabo EU/UK and OVH Gravelines. With the 2 s
      // defaults a 2-3 s stall of one link already counts as a lost leader:
      // on 2026-10-25 at 19:17 UTC one such stall moved the quorum leader and
      // left 491 partitions short of a copy for 10 minutes, and the UK
      // controller still logs 1-2 s fetch timeouts several times an hour.
      // A lost node is still noticed within seconds; a blip no longer is.
      ['controller.quorum.request.timeout.ms', '5000'],
      ['controller.quorum.fetch.timeout.ms', '6000'],
      ['log.dirs', '/var/lib/kafka/data'],
      ...commonSecurity(superUsers),
    ]
    if (isController) {
      entries.push(
        ['listeners', `CONTROLLER://${address}:${PORTS.controller}`],
        ['listener.security.protocol.map', 'CONTROLLER:SSL'],
        ['ssl.client.auth', 'required'],
        // Topic-creation defaults move to the controller role in Kafka 5.0.
        ['default.replication.factor', rf],
        ['num.partitions', '1'],
      )
    } else {
      entries.push(
        ['broker.rack', host.site],
        ['listeners', `CLIENT://${address}:${PORTS.client},REPLICATION://${address}:${PORTS.replication}`],
        ['advertised.listeners', `CLIENT://${address}:${PORTS.client},REPLICATION://${address}:${PORTS.replication}`],
        ['listener.security.protocol.map', 'CLIENT:SASL_SSL,REPLICATION:SSL,CONTROLLER:SSL'],
        ['inter.broker.listener.name', 'REPLICATION'],
        ['listener.name.replication.ssl.client.auth', 'required'],
        ['listener.name.client.ssl.client.auth', 'none'],
        ['listener.name.client.sasl.enabled.mechanisms', 'SCRAM-SHA-512'],
        ['listener.name.client.scram-sha-512.sasl.jaas.config', 'org.apache.kafka.common.security.scram.ScramLoginModule required;'],
        ['auto.create.topics.enable', 'false'],
        ['default.replication.factor', rf],
        ['min.insync.replicas', minIsr],
        ['unclean.leader.election.enable', 'false'],
        ['offsets.topic.replication.factor', rf],
        ['transaction.state.log.replication.factor', rf],
        ['transaction.state.log.min.isr', minIsr],
        ['num.partitions', '1'],
        ['delete.topic.enable', 'true'],
        ['log.segment.bytes', '268435456'],
      )
    }
    const dir = host.name
    files[`${dir}/server.properties`] = properties(entries)
    files[`${dir}/kafka.env`] = properties([
      ['CLUSTER_ID', inventory.clusterId],
      ['KAFKA_HEAP_OPTS', `-Xms${heap}m -Xmx${heap}m`],
      // The image declares /var/lib/kafka/data as a volume owned by its own
      // appuser; process logs stay off it (stdout is captured by Docker).
      ['LOG_DIR', '/tmp/kafka-logs'],
    ])
    files[`${dir}/compose.yml`] = renderCompose(host.name)
  }
  return files
}

export const WIREGUARD_PORT = 51820
export const SOURCE_ROLE = 'source'
// Overlay ports and the roles allowed to open them. Everything else on the
// overlay, and every Kafka/Connect/Registry port on the public interface, is
// dropped. Operators administer over SSH on the host itself.
export const OVERLAY_RULES = [
  { port: PORTS.client, on: 'broker', from: ['connect', 'mirror', 'monitoring', SOURCE_ROLE] },
  { port: PORTS.replication, on: 'broker', from: ['broker'], sameCluster: true },
  { port: PORTS.controller, on: 'controller', from: ['controller', 'broker'], sameCluster: true },
  { port: 8080, on: 'registry', from: ['connect', 'monitoring', SOURCE_ROLE] },
  // Distributed Connect workers forward REST calls to the group leader.
  { port: 8083, on: 'connect', from: ['connect'], sameCluster: true },
  { port: 5432, on: SOURCE_ROLE, from: ['connect'] },
  { port: 9100, on: '*', from: ['monitoring'] },
  { port: 7071, on: '*', from: ['monitoring'] },
]

// All hosts of every cluster, monitoring and the source host, with roles.
export function meshMembers(topology) {
  return [
    ...topology.clusters.flatMap((c) => c.hosts.map((h) => ({ ...h, cluster: c.name }))),
    ...topology.monitoring,
    { name: topology.sourceHost.name, site: topology.sourceHost.site, roles: [SOURCE_ROLE] },
  ]
}

function meshEntry(inventory, name) {
  const entry = inventory.hosts?.[name] ?? {}
  addressOf(inventory, name)
  if (!/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(entry.address)) throw new Error(`${name}: overlay address must be a 10.x IPv4 address`)
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(entry.publicAddress ?? '')) throw new Error(`${name}: publicAddress must be an IPv4 address`)
  if (!/^[A-Za-z0-9+/]{43}=$/.test(entry.wgPublicKey ?? '')) throw new Error(`${name}: wgPublicKey must be a WireGuard public key`)
  return entry
}

// wg0.conf and an nftables ruleset for one mesh member. The private key stays
// on the host (/etc/wireguard/ld-kafka.key) and is loaded by PostUp.
export function renderHostNetwork({ topology, inventory, hostName }) {
  const members = meshMembers(topology).filter((m) => inventory.hosts?.[m.name])
  const self = members.find((m) => m.name === hostName)
  if (!self) throw new Error(`${hostName} is not a mesh member in the inventory`)
  const me = meshEntry(inventory, hostName)
  const peers = members.filter((m) => m.name !== hostName).map((m) => ({ ...m, ...meshEntry(inventory, m.name) }))
  const overlays = new Set(members.map((m) => meshEntry(inventory, m.name).address))
  if (overlays.size !== members.length) throw new Error('overlay addresses must be unique')

  const wg = [
    '# Rendered by scripts/event-platform/cluster/render.mjs — do not edit on the host.',
    '[Interface]',
    `Address = ${me.address}/24`,
    `ListenPort = ${WIREGUARD_PORT}`,
    'PostUp = wg set %i private-key /etc/wireguard/ld-kafka.key',
    ...peers.flatMap((p) => [
      '',
      `# ${p.name} (${p.site})`,
      '[Peer]',
      `PublicKey = ${p.wgPublicKey}`,
      `AllowedIPs = ${p.address}/32`,
      `Endpoint = ${p.publicAddress}:${WIREGUARD_PORT}`,
      'PersistentKeepalive = 25',
    ]),
  ].join('\n') + '\n'

  const accepts = []
  for (const rule of OVERLAY_RULES) {
    if (rule.on !== '*' && !self.roles.includes(rule.on)) continue
    const sources = peers
      .filter((p) => p.roles.some((r) => rule.from.includes(r)))
      .filter((p) => !rule.sameCluster || p.cluster === self.cluster)
      .map((p) => p.address)
    if (sources.length) accepts.push(`    iifname "wg0" ip saddr { ${sources.join(', ')} } tcp dport ${rule.port} accept`)
  }
  const peerPublic = peers.map((p) => p.publicAddress)
  if (self.roles.includes(SOURCE_ROLE)) {
    // The production web/PostgreSQL host keeps its own firewall and public
    // services; this table only confines the overlay and the tunnel port.
    const nft = `#!/usr/sbin/nft -f
# Rendered by scripts/event-platform/cluster/render.mjs — do not edit on the host.
table inet ld_kafka
delete table inet ld_kafka
table inet ld_kafka {
  chain input {
    type filter hook input priority 0; policy accept;
    udp dport ${WIREGUARD_PORT} ip saddr { ${peerPublic.join(', ')} } accept
    udp dport ${WIREGUARD_PORT} drop
    iifname "wg0" ct state established,related accept
${accepts.join('\n')}
    iifname "wg0" drop
  }
}
`
    // ufw (already active on that host) filters the same packets, so it must
    // admit the tunnel and the CDC port too. PostgreSQL itself must listen
    // only on loopback and this overlay address.
    const cdcSources = peers.filter((q) => q.roles.includes('connect')).map((q) => q.address)
    const ufw = [
      '#!/usr/bin/env bash',
      '# Rendered by scripts/event-platform/cluster/render.mjs — idempotent ufw rules for the source host.',
      'set -euo pipefail',
      ...peers.map((q) => `ufw allow proto udp from ${q.publicAddress} to any port ${WIREGUARD_PORT} comment 'ld-kafka wg ${q.name}'`),
      ...cdcSources.map((a) => `ufw allow in on wg0 proto tcp from ${a} to ${me.address} port 5432 comment 'ld-kafka cdc'`),
    ].join('\n') + '\n'
    return { 'wg0.conf': wg, 'nftables.conf': nft, 'ufw.sh': ufw }
  }
  const nft = `#!/usr/sbin/nft -f
# Rendered by scripts/event-platform/cluster/render.mjs — do not edit on the host.
table inet ld_kafka
delete table inet ld_kafka
table inet ld_kafka {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state established,related accept
    ct state invalid drop
    ip protocol icmp accept
    ip6 nexthdr ipv6-icmp accept
    tcp dport 22 accept
${peerPublic.length ? `    udp dport ${WIREGUARD_PORT} ip saddr { ${peerPublic.join(', ')} } accept\n` : ''}${accepts.join('\n')}${accepts.length ? '\n' : ''}  }
}
`
  return { 'wg0.conf': wg, 'nftables.conf': nft }
}

// Production unit: host networking so listeners bind only to the WireGuard
// address in server.properties; storage is formatted once and never re-formatted.
function renderCompose(name) {
  return `# Rendered by scripts/event-platform/cluster/render.mjs — do not edit on the host.
services:
  kafka:
    image: ${KAFKA_IMAGE}
    container_name: ${name}
    network_mode: host
    restart: unless-stopped
    env_file: kafka.env
    user: "${KAFKA_UID}:${KAFKA_UID}"
    entrypoint: ["/bin/bash", "-ec"]
    command:
      - >-
        /opt/kafka/bin/kafka-storage.sh format --ignore-formatted --cluster-id="$$CLUSTER_ID" -c /etc/kafka/server.properties &&
        exec /opt/kafka/bin/kafka-server-start.sh /etc/kafka/server.properties
    volumes:
      - ./server.properties:/etc/kafka/server.properties:ro
      - /etc/leaddrive-kafka/tls:/etc/kafka/tls:ro
      - /var/lib/leaddrive-kafka:/var/lib/kafka/data
    ulimits:
      nofile: 100000
    logging:
      driver: json-file
      options:
        max-size: 50m
        max-file: "5"
`
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`)
    args[argv[i].slice(2)] = argv[i + 1]
  }
  return args
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'topics') {
  // render.mjs topics ENV -> "name<TAB>partitions<TAB>rf<TAB>k=v,k=v" per catalog topic
  for (const topic of expandCatalog(loadCatalog(), process.argv[3] ?? '')) {
    const config = Object.entries(topic.config).map(([k, v]) => `${k}=${v}`).join(',')
    console.log([topic.name, topic.partitions, topic.replicationFactor, config].join('\t'))
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'network') {
  // render.mjs network --inventory FILE --out DIR -> DIR/<host>/{wg0.conf,nftables.conf} for every member in the inventory
  const args = parseArgs(process.argv.slice(3))
  const topology = loadTopology()
  const inventory = JSON.parse(readFileSync(args.inventory, 'utf8'))
  for (const member of meshMembers(topology).filter((m) => inventory.hosts?.[m.name])) {
    for (const [file, content] of Object.entries(renderHostNetwork({ topology, inventory, hostName: member.name }))) {
      mkdirSync(path.join(args.out, member.name), { recursive: true })
      writeFileSync(path.join(args.out, member.name, file), content, { mode: 0o644 })
    }
  }
  console.log(`rendered network for ${Object.keys(inventory.hosts).length} inventory hosts`)
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  for (const required of ['cluster', 'inventory', 'out']) if (!args[required]) throw new Error(`--${required} is required`)
  const files = renderCluster({
    topology: loadTopology(),
    catalog: loadCatalog(),
    clusterName: args.cluster,
    inventory: JSON.parse(readFileSync(args.inventory, 'utf8')),
    heapScale: args['heap-scale'] ? Number(args['heap-scale']) : 1,
  })
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(args.out, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, { mode: 0o644 })
  }
  console.log(`rendered ${Object.keys(files).length} files for cluster ${args.cluster}`)
}
