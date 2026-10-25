import assert from 'node:assert/strict'
import test from 'node:test'
import { expandCatalog, loadCatalog, loadTopology } from './render.mjs'
import { readFileSync } from 'node:fs'
import { PRINCIPALS, aclBindings, connectSecretEnv, heartbeatTopic, infraTopics, registrySecretEnv, renderServiceHost, renderSourceConnector } from './services.mjs'

const topology = loadTopology()
const topics = expandCatalog(loadCatalog(), 'prod')
const grants = aclBindings('prod', topics).map((args) => args.join(' '))
const grantsFor = (principal) => grants.filter((g) => g.includes(`User:${principal} `))

test('each service identity gets only the access its job needs', () => {
  const connect = grantsFor(PRINCIPALS.connect)
  assert.equal(connect.filter((g) => /--topic ld\.prod\.[a-z-]+\.events\.v1 /.test(g)).length, 27)
  for (const g of connect.filter((g) => /\.events\.v1 /.test(g))) assert.doesNotMatch(g, /--operation Read/, 'connect never reads business events')
  assert.ok(!connect.some((g) => /(replay|quarantine)\.v1/.test(g)), 'connect cannot reach replay or quarantine')
  assert.ok(!connect.some((g) => /--operation (Create|Alter|Delete|All)\b/.test(g)))

  const fund = grantsFor(PRINCIPALS.fundWorker)
  assert.deepEqual(fund.filter((g) => g.includes('--topic')).map((g) => g.match(/--topic (\S+)/)[1]), ['ld.prod.finance.events.v1'])
  assert.ok(!fund.some((g) => /--operation (Write|IdempotentWrite)/.test(g)), 'the fund worker only reads')
  // Every admin call the bridge makes at start must be granted, or it never
  // reaches READY on an ACL-enforcing cluster (the CI stack has no ACLs).
  const bridge = readFileSync(new URL('../../../ops/event-platform/driver/KafkaPartitionBridge.java', import.meta.url), 'utf8')
  const financeGrant = fund.find((g) => g.includes('--topic ld.prod.finance.events.v1'))
  for (const [call, operation] of [['describeTopics', 'Describe'], ['describeConfigs', 'DescribeConfigs']]) {
    if (bridge.includes(`admin.${call}(`)) assert.match(financeGrant, new RegExp(`--operation ${operation}\\b`), `bridge calls ${call}`)
  }

  const registry = grantsFor(PRINCIPALS.registry)
  for (const g of registry.filter((g) => g.includes('--topic'))) {
    assert.match(g, /--topic ld\.prod\.registry\. .*--resource-pattern-type prefixed/)
  }
})

test('platform topics are replicated three times and the registry journal never expires', () => {
  for (const t of infraTopics('prod')) {
    assert.equal(t.replicationFactor, 3)
    assert.equal(t.config['min.insync.replicas'], '2')
  }
  const journal = infraTopics('prod').find((t) => t.name === 'ld.prod.registry.journal')
  assert.equal(journal.config['retention.ms'], '-1')
  assert.equal(infraTopics('prod').find((t) => t.name === 'ld.prod.connect.config').partitions, 1)
})

test('Connect and Registry talk to delivered brokers over SCRAM/TLS and listen on the overlay only', () => {
  const inventory = { hosts: {
    'kafka-p-broker-eu': { address: '10.88.0.10' }, 'kafka-p-broker-uk': { address: '10.88.0.11' },
    'kafka-p-connect-eu': { address: '10.88.0.16' },
  } }
  const files = renderServiceHost({ topology, inventory, clusterName: 'primary', envName: 'prod', hostName: 'kafka-p-connect-eu' })
  assert.match(files['connect.env'], /^BOOTSTRAP_SERVERS=10\.88\.0\.10:9092,10\.88\.0\.11:9092$/m, 'a pending broker is not in the bootstrap list')
  for (const prefix of ['CONNECT_', 'CONNECT_PRODUCER_', 'CONNECT_CONSUMER_']) {
    assert.match(files['connect.env'], new RegExp(`^${prefix}SECURITY_PROTOCOL=SASL_SSL$`, 'm'))
  }
  assert.match(files['connect.env'], /^REST_HOST_NAME=10\.88\.0\.16$/m)
  assert.match(files['connect.env'], /^CONNECT_TOPIC_CREATION_ENABLE=false$/m)
  assert.match(files['registry.env'], /^APICURIO_KAFKA_COMMON_SECURITY_PROTOCOL=SASL_SSL$/m)
  assert.match(files['registry.env'], /^QUARKUS_HTTP_HOST=10\.88\.0\.16$/m)
  for (const topic of files['registry.env'].match(/^APICURIO_(KAFKASQL_TOPIC|KAFKASQL_SNAPSHOTS_TOPIC|EVENTS_KAFKA_TOPIC)=(.*)$/gm)) {
    assert.match(topic, /=ld\.prod\.registry\./, `${topic} must sit under the registry ACL prefix`)
  }
  for (const f of Object.values(files)) assert.doesNotMatch(f, /password=|JAAS_CONFIG/i, 'no secret in rendered files')
  assert.throws(() => renderServiceHost({ topology, inventory, clusterName: 'primary', envName: 'prod', hostName: 'kafka-p-broker-eu' }), /not a connect/)
})

test('secret env files refuse weak passwords', () => {
  assert.throws(() => connectSecretEnv('short'), /24/)
  assert.throws(() => registrySecretEnv('has"quote-and-is-long-enough-123'), /alphanumeric/)
  assert.match(connectSecretEnv('a'.repeat(32)), /^CONNECT_PRODUCER_SASL_JAAS_CONFIG=.*username="ld-connect"/m)
})

test('Connect reaches the source by its certificate name over the overlay and keeps the password out of the config topic', () => {
  const inventory = { hosts: { 'kafka-p-broker-eu': { address: '10.88.0.10' }, 'kafka-p-connect-eu': { address: '10.88.0.16' } } }
  const source = { tlsName: topology.sourceHost.postgresTlsName, address: '10.88.0.26', dbname: topology.sourceHost.database }
  const files = renderServiceHost({ topology, inventory, clusterName: 'primary', envName: 'prod', hostName: 'kafka-p-connect-eu', source })
  assert.match(files['compose.yml'], /- "vmi3554743\.contaboserver\.net:10\.88\.0\.26"/)
  assert.match(files['compose.yml'], /source-postgres\.pem:\/etc\/kafka\/tls\/source-postgres\.pem:ro/)
  assert.match(files['connect.env'], /^CONNECT_CONFIG_PROVIDERS_FILE_CLASS=org\.apache\.kafka\.common\.config\.provider\.FileConfigProvider$/m)
  assert.throws(() => renderServiceHost({ topology, inventory, clusterName: 'primary', envName: 'prod', hostName: 'kafka-p-connect-eu', source: { ...source, address: '13.140.132.245' } }), /overlay/)

  const template = JSON.parse(readFileSync(new URL('../../../ops/event-platform/debezium/event-outbox-connector.template.json', import.meta.url), 'utf8'))
  const connector = renderSourceConnector({ template, envName: 'prod', source })
  assert.equal(connector.name, 'leaddrive-event-outbox-prod')
  assert.equal(connector.config['database.hostname'], 'vmi3554743.contaboserver.net')
  assert.equal(connector.config['database.dbname'], 'leaddrive_v2')
  assert.equal(connector.config['database.password'], '${file:/etc/kafka/secrets/cdc.properties:password}')
  assert.equal(connector.config['slot.name'], 'leaddrive_event_outbox_prod')
  assert.equal(connector.config['transforms.outbox.route.topic.replacement'], 'ld.prod.$1.events.v1')
  // Heartbeats keep the slot moving while the outbox is quiet; their topic is
  // a platform topic under the prefix Connect may write, never an events topic.
  assert.equal(connector.config['heartbeat.interval.ms'], '60000')
  const beat = `${connector.config['topic.heartbeat.prefix']}.${connector.config['topic.prefix']}`
  assert.equal(beat, heartbeatTopic('prod'))
  assert.ok(infraTopics('prod').some((t) => t.name === beat))
  assert.ok(grantsFor(PRINCIPALS.connect).some((g) => /--operation Write .*--topic ld\.prod\.connect\. --resource-pattern-type prefixed/.test(g)) && beat.startsWith('ld.prod.connect.'))
  assert.doesNotMatch(beat, /\.events\.v1$/)
  // The heartbeat's own WAL message is consumed, never emitted as a record.
  assert.match(connector.config['heartbeat.action.query'], /^SELECT pg_logical_emit_message\(false, '([a-z-]+)', ''\)$/)
  // Allow-list that admits nothing: neither the heartbeat nor any foreign
  // prefix is emitted, so no message can hit the unwritable .message topic.
  const prefix = connector.config['heartbeat.action.query'].match(/'([a-z-]+)'/)[1]
  assert.equal(connector.config['message.prefix.exclude.list'], undefined)
  const allowed = connector.config['message.prefix.include.list'].split(',')
  assert.ok(allowed.length === 1 && !new RegExp(`^(?:${allowed[0]})$`).test(prefix), 'the heartbeat prefix is not emitted')
  for (const foreign of ['drill-foreign-prefix', 'pgaudit', 'wal2json', '']) assert.ok(!new RegExp(`^(?:${allowed[0]})$`).test(foreign))
})
