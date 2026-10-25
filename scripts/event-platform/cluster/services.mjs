// Kafka Connect (Debezium) and Schema Registry (Apicurio, KafkaSQL storage) on
// the connect/registry hosts of topology.v1.json, plus the service identities
// and least-privilege ACLs every client of the cluster gets.
//
// Nothing here holds a secret. SCRAM passwords live in per-host
// *.secret.env files that provision.sh writes from the operator's store.
import { PORTS, addressOf } from './render.mjs'

export const CONNECT_IMAGE = 'ghcr.io/rashadoni/debezium-connect:3.7.0.Final-8107474c18d5@sha256:8107474c18d56317c007dd930f2782c9636198a895144a0c1dddd6d6a7536d6e'
export const REGISTRY_IMAGE = 'apicurio/apicurio-registry:3.3.0@sha256:25b302bc1ecf53cb01bda4f39749f175c94f3f6d27dcc57123d25714e4a0b117'
export const CONNECT_REST_PORT = 8083
export const REGISTRY_PORT = 8080

export const PRINCIPALS = Object.freeze({
  connect: 'ld-connect',
  registry: 'ld-registry',
  fundWorker: 'ld-fund-worker',
})

export function connectGroup(env) { return `ld-${env}-connect` }

// Topics the platform itself needs besides the domain catalog. Connect's
// internal topics are compacted; the registry journal is the registry's only
// storage, so it is never deleted by retention.
export function infraTopics(env) {
  const compact = { 'cleanup.policy': 'compact', 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' }
  const forever = { 'cleanup.policy': 'delete', 'retention.ms': '-1', 'retention.bytes': '-1', 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' }
  return [
    { name: `ld.${env}.connect.config`, partitions: 1, replicationFactor: 3, config: compact },
    { name: `ld.${env}.connect.offset`, partitions: 3, replicationFactor: 3, config: compact },
    { name: `ld.${env}.connect.status`, partitions: 1, replicationFactor: 3, config: compact },
    // Debezium heartbeats (see slotHeartbeat); only the latest one matters.
    { name: heartbeatTopic(env), partitions: 1, replicationFactor: 3,
      config: { 'cleanup.policy': 'delete', 'retention.ms': '86400000', 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' } },
    { name: `ld.${env}.registry.journal`, partitions: 1, replicationFactor: 3, config: forever },
    { name: `ld.${env}.registry.snapshots`, partitions: 1, replicationFactor: 3, config: forever },
    // Change notifications the registry publishes (artifact created, etc.).
    { name: `ld.${env}.registry.events`, partitions: 1, replicationFactor: 3,
      config: { 'cleanup.policy': 'delete', 'retention.ms': '604800000', 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' } },
  ]
}

// Each binding is the argument list for one `kafka-acls.sh --add` call.
export function aclBindings(env, catalogTopics) {
  const allow = (principal, ops, resource, pattern = 'literal') => [
    '--allow-principal', `User:${principal}`, ...ops.flatMap((op) => ['--operation', op]),
    ...resource, '--resource-pattern-type', pattern,
  ]
  const events = catalogTopics.filter((t) => t.name.endsWith('.events.v1')).map((t) => t.name)
  const financeEvents = `ld.${env}.finance.events.v1`
  if (!events.includes(financeEvents)) throw new Error(`catalog has no ${financeEvents}`)
  return [
    // Debezium writes routed outbox records to events topics only.
    ...events.map((topic) => allow(PRINCIPALS.connect, ['Write', 'Describe'], ['--topic', topic])),
    allow(PRINCIPALS.connect, ['IdempotentWrite'], ['--cluster']),
    allow(PRINCIPALS.connect, ['Read', 'Write', 'Describe', 'DescribeConfigs'], ['--topic', `ld.${env}.connect.`], 'prefixed'),
    allow(PRINCIPALS.connect, ['Read'], ['--group', connectGroup(env)]),
    // The registry reads and writes only its own journal and snapshots. Its
    // KafkaSQL consumer uses a generated group id per instance.
    allow(PRINCIPALS.registry, ['Read', 'Write', 'Describe', 'DescribeConfigs'], ['--topic', `ld.${env}.registry.`], 'prefixed'),
    allow(PRINCIPALS.registry, ['IdempotentWrite'], ['--cluster']),
    allow(PRINCIPALS.registry, ['Read'], ['--group', '*']),
    // The Fund shadow worker only consumes Finance events.
    allow(PRINCIPALS.fundWorker, ['Read', 'Describe'], ['--topic', financeEvents]),
    allow(PRINCIPALS.fundWorker, ['Read'], ['--group', `ld.${env}.fund-shadow.`], 'prefixed'),
  ]
}

function env(entries) {
  return `${entries.map(([k, v]) => `${k}=${v}`).join('\n')}\n`
}

const clientSecurity = (prefix) => [
  [`${prefix}SECURITY_PROTOCOL`, 'SASL_SSL'],
  [`${prefix}SASL_MECHANISM`, 'SCRAM-SHA-512'],
  [`${prefix}SSL_TRUSTSTORE_TYPE`, 'PEM'],
  [`${prefix}SSL_TRUSTSTORE_LOCATION`, '/etc/kafka/tls/ca.pem'],
  [`${prefix}SSL_ENDPOINT_IDENTIFICATION_ALGORITHM`, 'https'],
  [`${prefix}SSL_ENABLED_PROTOCOLS`, 'TLSv1.3'],
]

export function scramJaas(user, password) {
  if (!/^[a-z][a-z0-9-]*$/.test(user)) throw new Error('bad SCRAM user')
  if (!/^[A-Za-z0-9]{24,}$/.test(password)) throw new Error('SCRAM password must be >= 24 alphanumeric characters')
  return `org.apache.kafka.common.security.scram.ScramLoginModule required username="${user}" password="${password}";`
}

// Secret env files, rendered only on the operator workstation at push time.
export function connectSecretEnv(password) {
  const jaas = scramJaas(PRINCIPALS.connect, password)
  return env([['CONNECT_SASL_JAAS_CONFIG', jaas], ['CONNECT_PRODUCER_SASL_JAAS_CONFIG', jaas], ['CONNECT_CONSUMER_SASL_JAAS_CONFIG', jaas]])
}
export function registrySecretEnv(password) {
  return env([['APICURIO_KAFKA_COMMON_SASL_JAAS_CONFIG', scramJaas(PRINCIPALS.registry, password)]])
}

// source: { tlsName, address } maps the source PostgreSQL's certificate name to
// its overlay address inside the Connect container, so verify-full checks the
// certificate the source already serves.
export function renderServiceHost({ topology, inventory, clusterName, envName, hostName, heap = { connect: 1024, registry: 512 }, source }) {
  if (!/^[a-z][a-z0-9]*$/.test(envName)) throw new Error(`environment slug must match [a-z][a-z0-9]*: ${envName}`)
  const cluster = topology.clusters.find((c) => c.name === clusterName)
  const host = cluster?.hosts.find((h) => h.name === hostName)
  if (!host?.roles.includes('connect') || !host.roles.includes('registry')) throw new Error(`${hostName} is not a connect/registry host of ${clusterName}`)
  const address = addressOf(inventory, hostName)
  if (source && (!/^[a-z0-9][a-z0-9.-]*\.[a-z]+$/.test(source.tlsName ?? '') || !/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(source.address ?? ''))) {
    throw new Error('source needs the certificate host name and its 10.x overlay address')
  }
  const bootstrap = cluster.hosts
    .filter((h) => h.roles.includes('broker') && inventory.hosts?.[h.name]?.address)
    .map((h) => `${addressOf(inventory, h.name)}:${PORTS.client}`).join(',')
  if (!bootstrap) throw new Error('no delivered broker to bootstrap from')

  const connect = env([
    ['BOOTSTRAP_SERVERS', bootstrap],
    ['GROUP_ID', connectGroup(envName)],
    ['CONFIG_STORAGE_TOPIC', `ld.${envName}.connect.config`],
    ['OFFSET_STORAGE_TOPIC', `ld.${envName}.connect.offset`],
    ['STATUS_STORAGE_TOPIC', `ld.${envName}.connect.status`],
    ['CONNECT_CONFIG_STORAGE_REPLICATION_FACTOR', '3'],
    ['CONNECT_OFFSET_STORAGE_REPLICATION_FACTOR', '3'],
    ['CONNECT_STATUS_STORAGE_REPLICATION_FACTOR', '3'],
    ['CONNECT_OFFSET_STORAGE_PARTITIONS', '3'],
    ['CONNECT_STATUS_STORAGE_PARTITIONS', '1'],
    ['CONNECT_TOPIC_CREATION_ENABLE', 'false'],
    ['CONNECT_PRODUCER_ACKS', 'all'],
    ['CONNECT_PRODUCER_ENABLE_IDEMPOTENCE', 'true'],
    ['KEY_CONVERTER', 'org.apache.kafka.connect.storage.StringConverter'],
    ['VALUE_CONVERTER', 'org.apache.kafka.connect.storage.StringConverter'],
    ['REST_HOST_NAME', address],
    ['REST_PORT', String(CONNECT_REST_PORT)],
    ['ADVERTISED_HOST_NAME', address],
    ['ADVERTISED_PORT', String(CONNECT_REST_PORT)],
    ['OFFSET_FLUSH_INTERVAL_MS', '1000'],
    ['HEAP_OPTS', `-Xms${heap.connect}m -Xmx${heap.connect}m`],
    // The CDC database password is read from a mounted file at task start and
    // never stored in the Connect config topic.
    ['CONNECT_CONFIG_PROVIDERS', 'file'],
    ['CONNECT_CONFIG_PROVIDERS_FILE_CLASS', 'org.apache.kafka.common.config.provider.FileConfigProvider'],
    ...clientSecurity('CONNECT_'),
    ...clientSecurity('CONNECT_PRODUCER_'),
    ...clientSecurity('CONNECT_CONSUMER_'),
  ])
  const registry = env([
    ['APICURIO_STORAGE_KIND', 'kafkasql'],
    ['APICURIO_KAFKASQL_BOOTSTRAP_SERVERS', bootstrap],
    ['APICURIO_KAFKASQL_TOPIC', `ld.${envName}.registry.journal`],
    ['APICURIO_KAFKASQL_SNAPSHOTS_TOPIC', `ld.${envName}.registry.snapshots`],
    ['APICURIO_KAFKASQL_TOPIC_AUTO_CREATE', 'false'],
    // Default is "registry-events", outside the registry's ACL prefix.
    ['APICURIO_EVENTS_KAFKA_TOPIC', `ld.${envName}.registry.events`],
    ['APICURIO_KAFKA_COMMON_BOOTSTRAP_SERVERS', bootstrap],
    ...clientSecurity('APICURIO_KAFKA_COMMON_'),
    ['QUARKUS_HTTP_HOST', address],
    ['QUARKUS_HTTP_PORT', String(REGISTRY_PORT)],
    ['QUARKUS_OTEL_SDK_DISABLED', 'true'],
    ['JAVA_TOOL_OPTIONS', `-Xms${Math.min(256, heap.registry)}m -Xmx${heap.registry}m`],
  ])
  const compose = `# Rendered by scripts/event-platform/cluster/services.mjs — do not edit on the host.
services:
  connect:
    image: ${CONNECT_IMAGE}
    container_name: ${hostName}-connect
    network_mode: host
    restart: unless-stopped
    env_file: [connect.env, connect.secret.env]
    volumes:
      - /etc/leaddrive-kafka/tls/ca.pem:/etc/kafka/tls/ca.pem:ro
${source ? `      - /etc/leaddrive-kafka/tls/source-postgres.pem:/etc/kafka/tls/source-postgres.pem:ro
      - /etc/leaddrive-kafka/services/secrets/cdc.properties:/etc/kafka/secrets/cdc.properties:ro
    extra_hosts:
      - "${source.tlsName}:${source.address}"
` : ''}    logging: { driver: json-file, options: { max-size: 50m, max-file: "5" } }
  registry:
    image: ${REGISTRY_IMAGE}
    container_name: ${hostName}-registry
    network_mode: host
    restart: unless-stopped
    env_file: [registry.env, registry.secret.env]
    volumes:
      - /etc/leaddrive-kafka/tls/ca.pem:/etc/kafka/tls/ca.pem:ro
    logging: { driver: json-file, options: { max-size: 50m, max-file: "5" } }
`
  return { 'connect.env': connect, 'registry.env': registry, 'compose.yml': compose }
}

// The outbox is quiet most of the time while the rest of the database writes
// ~0.3 GB of WAL a day. Debezium confirms to the slot only positions of events
// it emitted, so the slot kept every byte since the last outbox row
// (production, 2026-10-23). Heartbeat records alone do not move it (drill run
// 40024551361), and lsn.flush.mode=connector_and_driver lets the driver
// confirm past the stored offset, which on restart either refuses to start or
// skips the gap. Instead each heartbeat writes a logical-decoding message the
// slot must deliver; Debezium consumes it without emitting it (excluded
// prefix), advances its offset, and the next heartbeat commits that offset.
// The heartbeat topic sits under the connect prefix ld-connect may write.
export const SLOT_MESSAGE_PREFIX = 'ld-slot-heartbeat'
export function heartbeatTopic(env) { return `ld.${env}.connect.heartbeat.ld.${env}.cdc-source` }
export function slotHeartbeat(env) {
  return {
    'heartbeat.interval.ms': '60000',
    'heartbeat.topics.prefix': `ld.${env}.connect.heartbeat`,
    'heartbeat.action.query': `SELECT pg_logical_emit_message(false, '${SLOT_MESSAGE_PREFIX}', '')`,
    'message.prefix.exclude.list': SLOT_MESSAGE_PREFIX,
  }
}

// Debezium outbox connector for one environment, from the reviewed template.
// The password stays a FileConfigProvider reference.
export function renderSourceConnector({ template, envName, source }) {
  const replacements = {
    __ENV__: envName,
    __PGHOST__: source.tlsName,
    __PGDATABASE__: source.dbname,
    __SECRET_FROM_PROVIDER__: '${file:/etc/kafka/secrets/cdc.properties:password}',
    __PG_SSL_ROOT_CERT_PATH__: '/etc/kafka/tls/source-postgres.pem',
  }
  let text = JSON.stringify(template)
  for (const [token, value] of Object.entries(replacements)) text = text.replaceAll(token, value)
  if (/__[A-Z_]+__/.test(text)) throw new Error('unresolved placeholder in connector template')
  const connector = JSON.parse(text)
  Object.assign(connector.config, slotHeartbeat(envName))
  if (connector.config['database.sslmode'] !== 'verify-full') throw new Error('connector must use sslmode=verify-full')
  return connector
}
