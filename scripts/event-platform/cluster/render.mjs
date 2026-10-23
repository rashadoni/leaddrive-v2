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
// Heap per example plan; the rest of the host's memory is page cache.
const HEAP_MB = { 'Cloud VPS 20': 4096, 'VPS-2': 3072, 'Cloud VPS 10': 1024, 'VPS-1': 1024 }

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

function addressOf(inventory, name) {
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

export function renderCluster({ topology, catalog, clusterName, inventory, heapScale = 1 }) {
  const cluster = topology.clusters.find((c) => c.name === clusterName)
  if (!cluster) throw new Error(`unknown cluster ${clusterName}`)
  if (!/^[A-Za-z0-9_-]{22}$/.test(inventory.clusterId ?? '')) throw new Error('inventory.clusterId must be a 22-character Kafka cluster id')
  const ids = nodeIds(cluster)
  const controllers = cluster.hosts.filter((h) => h.roles.includes('controller'))
  const brokers = cluster.hosts.filter((h) => h.roles.includes('broker'))
  const voters = controllers.map((h) => `${ids.get(h.name)}@${addressOf(inventory, h.name)}:${PORTS.controller}`).join(',')
  const superUsers = [...controllers, ...brokers].map((h) => h.name).concat(ADMIN_PRINCIPAL)
  const rf = String(catalog.defaults.replicationFactor)
  const minIsr = catalog.defaults.config['min.insync.replicas']
  const files = {}

  for (const host of [...controllers, ...brokers]) {
    const address = addressOf(inventory, host.name)
    const isController = host.roles.includes('controller')
    const heap = Math.max(256, Math.round(((HEAP_MB[host.plan] ?? 1024) * heapScale) / 64) * 64)
    const entries = [
      ['process.roles', isController ? 'controller' : 'broker'],
      ['node.id', ids.get(host.name)],
      ['controller.quorum.voters', voters],
      ['controller.listener.names', 'CONTROLLER'],
      ['log.dirs', '/var/lib/kafka/data'],
      ...commonSecurity(superUsers),
    ]
    if (isController) {
      entries.push(
        ['listeners', `CONTROLLER://${address}:${PORTS.controller}`],
        ['listener.security.protocol.map', 'CONTROLLER:SSL'],
        ['ssl.client.auth', 'required'],
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
    ])
    files[`${dir}/compose.yml`] = renderCompose(host.name)
  }
  return files
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
    user: "1000:1000"
    entrypoint: ["/bin/bash", "-ec"]
    command:
      - >-
        /opt/kafka/bin/kafka-storage.sh format --ignore-formatted -t "$$CLUSTER_ID" -c /etc/kafka/server.properties &&
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
