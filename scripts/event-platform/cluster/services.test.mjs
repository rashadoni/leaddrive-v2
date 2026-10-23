import assert from 'node:assert/strict'
import test from 'node:test'
import { expandCatalog, loadCatalog, loadTopology } from './render.mjs'
import { PRINCIPALS, aclBindings, connectSecretEnv, infraTopics, registrySecretEnv, renderServiceHost } from './services.mjs'

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
  for (const f of Object.values(files)) assert.doesNotMatch(f, /password=|JAAS_CONFIG/i, 'no secret in rendered files')
  assert.throws(() => renderServiceHost({ topology, inventory, clusterName: 'primary', envName: 'prod', hostName: 'kafka-p-broker-eu' }), /not a connect/)
})

test('secret env files refuse weak passwords', () => {
  assert.throws(() => connectSecretEnv('short'), /24/)
  assert.throws(() => registrySecretEnv('has"quote-and-is-long-enough-123'), /alphanumeric/)
  assert.match(connectSecretEnv('a'.repeat(32)), /^CONNECT_PRODUCER_SASL_JAAS_CONFIG=.*username="ld-connect"/m)
})
