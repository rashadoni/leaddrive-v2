import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertFullCdcEnvironment, assertPrivatePostgresTarget, assertScratchDatabase, FULL_CDC_CONNECTOR,
  FULL_CDC_SLOT, POSTGRES_IMAGE, renderFullCdcBoundary, renderFullCdcConnector } from './fixtures/cdc-fund-contract.mjs'
import { renderTestConnector } from './cdc-fixture.mjs'

const env = { GITHUB_ACTIONS: 'true', LD_EVENT_STACK_DISPOSABLE: '1', LD_EVENT_STACK_FULL_CDC_FUND: '1',
  FUND_SHADOW_DB_GATE: 'required', LD_EVENT_STACK_PROJECT: 'ld-event-test-full-cdc-123' }
const database = 'ld_fund_shadow_1234_abcdef012345'
const source = readFileSync(new URL('./test-cdc-fund-postgres.ts', import.meta.url), 'utf8')
const template = JSON.parse(readFileSync(new URL('../../ops/event-platform/debezium/event-outbox-connector.template.json', import.meta.url), 'utf8'))

test('full chain requires every explicit disposable admission and exact project namespace', () => {
  assertFullCdcEnvironment(env)
  for (const key of Object.keys(env)) assert.throws(() => assertFullCdcEnvironment({ ...env, [key]: undefined }))
  for (const project of ['production', 'ld-event-test-', 'ld-event-test-a/../../prod', 'ld-event-test-a\n']) {
    assert.throws(() => assertFullCdcEnvironment({ ...env, LD_EVENT_STACK_PROJECT: project }))
  }
})

test('loopback executable rejects missing CI or broad project before Docker is reachable', () => {
  const proxy = new URL('./fixtures/cdc-fund-loopback.mjs', import.meta.url)
  for (const invalid of [{}, { ...env, LD_EVENT_STACK_PROJECT: 'production' }, { ...env, LD_EVENT_STACK_FULL_CDC_FUND: '0' }]) {
    const result = spawnSync(process.execPath, [proxy.pathname, '--disposable-loopback-proxy'], {
      env: { ...invalid, PATH: '/nonexistent-no-docker' }, encoding: 'utf8', timeout: 5000,
    })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, /exact disposable Compose PostgreSQL inspection required/)
  }
})

function target() {
  const project = env.LD_EVENT_STACK_PROJECT, networkName = `${project}_default`, id = 'a'.repeat(64)
  return { project,
    config: { services: { postgres: { image: POSTGRES_IMAGE,
      environment: { POSTGRES_DB: 'event_platform_test', POSTGRES_USER: 'event_test' } } }, networks: { default: { internal: true } } },
    container: { Id: id, Config: { Image: POSTGRES_IMAGE, Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'postgres' } },
      State: { Running: true }, HostConfig: { NetworkMode: networkName, PortBindings: {} }, Mounts: [{ Type: 'volume' }],
      NetworkSettings: { Networks: { [networkName]: { NetworkID: 'private-network-id', IPAddress: '172.29.0.2' } } } },
    network: { Id: 'private-network-id', Name: networkName, Internal: true,
      Labels: { 'com.docker.compose.project': project, 'com.docker.compose.network': 'default' },
      Containers: { [id]: { IPv4Address: '172.29.0.2/16' } } },
  }
}

test('proxy pins the exact image, running PostgreSQL service and private network member with no host publication', () => {
  assert.equal(assertPrivatePostgresTarget(target()), '172.29.0.2')
  const mutations = [
    input => { input.config.services.postgres.image = 'postgres:latest' },
    input => { input.config.services.postgres.environment.POSTGRES_DB = 'production' },
    input => { input.config.services.postgres.ports = ['5432:5432'] },
    input => { input.config.services.postgres.volumes = [{ type: 'bind' }] },
    input => { input.config.networks.default.internal = false },
    input => { input.container.Config.Image = 'postgres:latest' },
    input => { input.container.Config.Labels['com.docker.compose.project'] = 'production' },
    input => { input.container.Config.Labels['com.docker.compose.service'] = 'other' },
    input => { input.container.State.Running = false },
    input => { input.container.HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] } },
    input => { input.container.Mounts = [{ Type: 'bind' }] },
    input => { input.container.HostConfig.NetworkMode = 'host' },
    input => { input.network.Internal = false },
    input => { input.network.Labels['com.docker.compose.project'] = 'production' },
    input => { input.network.Containers = {} },
    input => { input.network.Id = 'unrelated-network' },
    input => { input.container.NetworkSettings.Networks.extra = { IPAddress: '172.29.0.3' } },
    input => {
      input.container.NetworkSettings.Networks[input.network.Name].IPAddress = '13.140.132.245'
      input.network.Containers[input.container.Id].IPv4Address = '13.140.132.245/24'
    },
  ]
  for (const mutate of mutations) { const input = target(); mutate(input); assert.throws(() => assertPrivatePostgresTarget(input)) }
})

test('full Fund renderer changes only scratch DB and isolated connector/topic/slot identities from raw fixture', () => {
  const raw = renderTestConnector(template, { mode: 'raw' })
  const expected = structuredClone(raw)
  expected.name = FULL_CDC_CONNECTOR
  Object.assign(expected.config, { 'topic.prefix': 'ld.testbroker.cdc-source-fund', 'database.dbname': database,
    'slot.name': FULL_CDC_SLOT, 'transforms.outbox.route.topic.replacement': 'ld.testbroker.$1.events.v1' })
  assert.deepEqual(renderFullCdcConnector(template, database), expected)
  for (const name of ['production', 'event_platform_test', 'ld_fund_shadow_0_abcdef012345', `${database}';DROP DATABASE production;--`]) {
    assert.throws(() => assertScratchDatabase(name)); assert.throws(() => renderFullCdcConnector(template, name))
  }
  assert.equal(expected.config['value.converter'], template.config['value.converter'])
  assert.equal(expected.config['transforms.outbox.table.expand.json.payload'], 'false')
  assert.equal(expected.config['snapshot.select.statement.overrides.public.event_outbox'], template.config['snapshot.select.statement.overrides.public.event_outbox'])
  assert.equal(template.config['database.sslmode'], 'verify-full', 'production TLS is untouched')
})

test('read-only boundary renderer retains CDC checks and tightens real Fund ownership beyond transport anchors', () => {
  const boundary = readFileSync(new URL('../../ops/event-platform/test/assert-cdc-boundary.sql', import.meta.url), 'utf8')
  const rendered = renderFullCdcBoundary(boundary, database)
  const start = 'IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace'
  const end = '  END IF;'
  function withoutAnchor(value) {
    const from = value.indexOf(start), to = value.indexOf(end, from) + end.length
    assert.ok(from > 0 && to > from)
    return value.slice(0, from) + '<EXACT_REVIEWED_ANCHOR_OWNERSHIP_BLOCK>' + value.slice(to)
  }
  assert.equal(withoutAnchor(rendered.replace(`current_database() <> '${database}'`, "current_database() <> 'event_platform_test'")), withoutAnchor(boundary))
  assert.match(rendered, /c\.relname = 'organizations'[\s\S]*c\.relowner = app_oid/)
  assert.match(rendered, /c\.relname = 'funds'[\s\S]*c\.relowner = migrator_oid AND c\.relrowsecurity AND c\.relforcerowsecurity/)
  assert.throws(() => renderFullCdcBoundary(boundary.replace('event_platform_test', 'changed'), database))
  assert.throws(() => renderFullCdcBoundary(boundary + "\ncurrent_database() <> 'event_platform_test'", database))
  assert.throws(() => renderFullCdcBoundary(boundary.replace("c.relname IN ('organizations', 'funds')", "c.relname IN ('funds')"), database))
})

test('full-chain acceptance uses actual CDC as sole producer and restart/duplicate actual SQL evidence', () => {
  assert.match(source, /sourceAppWrites: true/)
  assert.match(source, /harness\.create\("finance", "empty"\)/)
  assert.doesNotMatch(source, /harness!?\.produce\(/)
  assert.match(source, /readFileSync\("ops\/event-platform\/postgres\/prepare-cdc\.sql", "utf8"\)/)
  assert.match(source, /raw JSONB bytes must survive actual EventRouter\/StringConverter/)
  assert.match(source, /same real group must redeliver the committed first SQL record/)
  assert.match(source, /fundShadowDatabase\(context\.client\)/)
  assert.match(source, /exact: true/)
  assert.match(source, /full_cdc_fund_source_active_effects_other_tenant_unchanged=PASS/)
  assert.match(source, /fixture_tls_acl=NOT_PROVEN; production_activation=NOT_RUN/)
  assert.doesNotMatch(source, /--reset-offsets|pg_replication_slot_advance|DISABLE TRIGGER|session_replication_role|ALTER SYSTEM|\bssh\b/)
})

test('recovery injects only an old restricted shadow fault and replays unchanged Kafka history into new builds/group', () => {
  const faultStart = source.indexOf('phase = "shadow-only-wrong-reducer-fault-injection"')
  const recoveryStart = source.indexOf('phase = "corrected-new-build-full-history-recovery"')
  assert.ok(faultStart > 0 && recoveryStart > faultStart)
  const fault = source.slice(faultStart, recoveryStart), recovery = source.slice(recoveryStart)
  assert.match(fault, /context\.client\.\$transaction\(async tx/)
  assert.match(fault, /currentRole: context\.scope\.expectedWorkerRole, sessionRole: context\.scope\.expectedWorkerRole, restricted: true/)
  assert.match(fault, /UPDATE fund_balance_projections SET balance=balance\+1\.0000::numeric\s+WHERE "organizationId"=\$1 AND "fundId"=\$2 AND "buildKey"=\$3 AND "projectionVersion"=2 AND status='shadow'/)
  assert.match(fault, /assert\.equal\(changed, 1,/)
  assert.match(fault, /balance: "11\.0000", currency: "USD", version: "6", exact: false, metadataUnchanged: true/)
  assert.doesNotMatch(fault, /db\.scratch\.\$executeRawUnsafe|UPDATE funds SET|UPDATE fund_transactions|UPDATE event_outbox|UPDATE consumer_inbox|UPDATE projection_checkpoints/)
  assert.match(recovery, /db\.newBuild\(context\.scope\.organizationId, context\.fundId, context\.records\)/)
  for (const field of ['buildId', 'buildKey', 'expectedWorkerRole']) {
    assert.ok(recovery.includes(`assert.notEqual(fresh.scope.${field}, context.scope.${field})`))
  }
  assert.match(recovery, /harness\.admitGroup\("finance-corrected", "finance", "0"\)/)
  assert.match(recovery, /start\(12, false, \{ contexts: corrected, groupName: "finance-corrected", observed: replayed \}\)/)
  assert.match(recovery, /assert\.deepEqual\(replayed, observed\.slice\(1\)\)/)
  assert.match(recovery, /await assertExactBuilds\(corrected, replayed\)/)
  assert.match(recovery, /assert\.deepEqual\(await snapshotOldBuilds\(\), badBuildsBeforeRecovery,/)
  assert.match(recovery, /harness\.fixture\("offset", "finance-corrected"\), "12"/)
  assert.match(recovery, /harness\.fixture\("offset", "finance"\), "12"/)
  assert.match(recovery, /assert\.deepEqual\(await snapshot\(\), before\)/)
  assert.match(recovery, /historical_bug_source=NOT_CLAIMED; corrected_new_build_recovery=PASS/)
})
