/** Disposable CI transport drill, never a production activation command. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bootstrapSql, phaseSql, renderTestConnector, fixtureKafkaTopic, FIXTURE } from './cdc-fixture.mjs'
import { verifyCdcRecords } from './verify-cdc-records.mjs'
import { compareExpandedCdcRecords } from './compare-expanded-cdc.mjs'
import { assertBoundedConsumerExit } from './consumer-observation.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const baseCompose = `${root}ops/event-platform/test/compose.yml`
const cdcCompose = `${root}ops/event-platform/test/cdc.compose.yml`
const project = process.env.LD_EVENT_STACK_PROJECT ?? ''
const foundation = `${root}prisma/migrations/20260901090000_event_platform_foundation/migration.sql`
const prepareCdc = `${root}ops/event-platform/postgres/prepare-cdc.sql`
const template = JSON.parse(readFileSync(`${root}ops/event-platform/debezium/event-outbox-connector.template.json`, 'utf8'))
const allowedModes = ['expanded', 'raw']
let overrideActive = false
let activeMode

function fail(message) { throw new Error(`Disposable CDC: ${message}`) }
function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
function execute(args, { input, allowFailure = false, timeout = 90000 } = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', input, timeout, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || (!allowFailure && result.status !== 0)) {
    // This runner has only public synthetic fixtures; still keep diagnostics bounded.
    fail(`bounded Docker command failed: ${(result.stderr ?? '').slice(-2000)}`)
  }
  return result
}
function compose(args, options) {
  return execute(['compose', '-p', project, '-f', baseCompose,
    ...(overrideActive ? ['-f', cdcCompose] : []), ...args], options)
}
function psql(role, password, sql, options) {
  return compose(['exec', '-T', '-e', `PGPASSWORD=${password}`, 'postgres', 'psql',
    '-h', '127.0.0.1', '-U', role, '-d', FIXTURE.database, '-X', '-qAt',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { input: sql, ...options })
}
function dba(sql, options) { return psql(FIXTURE.adminRole, 'synthetic-fixture-only', sql, options) }
function assertDenied(result, code) {
  if (result.status === 0 || !result.stderr.includes(code)) fail(`expected SQL rejection ${code} was not observed`)
}
function kafka(command, args, options) {
  return compose(['exec', '-T', '-e', 'KAFKA_HEAP_OPTS=-Xms32m -Xmx128m', 'kafka',
    `/opt/kafka/bin/${command}.sh`, ...args], options)
}
function http(path, { method = 'GET', body, allowFailure = false } = {}) {
  if (!/^\/connectors(?:\/[a-z0-9-]+(?:\/status)?)?$/.test(path)) fail('non-fixture Connect path')
  return compose(['exec', '-T', 'connect', 'curl', '--fail', '--silent', '--show-error', '--max-time', '5',
    '-X', method, ...(body ? ['-H', 'Content-Type: application/json', '--data-binary', '@-'] : []),
    `http://connect:8083${path}`], { input: body ? JSON.stringify(body) : undefined, allowFailure })
}
function connectorName(mode) {
  if (!allowedModes.includes(mode)) fail('non-fixture connector mode')
  return `leaddrive-event-outbox-test-${mode}`
}
function slotName(mode) {
  if (!allowedModes.includes(mode)) fail('non-fixture slot mode')
  return `leaddrive_event_outbox_test_${mode}`
}
function waitConnect() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = http('/connectors', { allowFailure: true })
    if (result.status === 0) return
    pause(1000)
  }
  fail('Connect readiness deadline exceeded')
}
function waitConnector(mode) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = http(`/connectors/${connectorName(mode)}/status`, { allowFailure: true })
    if (result.status === 0) {
      const status = JSON.parse(result.stdout)
      if (status.connector?.state === 'FAILED' || status.tasks?.some(task => task.state === 'FAILED')) {
        fail(`synthetic ${mode} connector/task failed`)
      }
      if (status.connector?.state === 'RUNNING' && status.tasks?.length === 1 && status.tasks[0].state === 'RUNNING') return
    }
    pause(1000)
  }
  fail('connector/task readiness deadline exceeded')
}
function expectedRows() {
  return JSON.parse(dba(`SET TIME ZONE 'UTC';
SELECT jsonb_agg(jsonb_build_object(
  'eventId', "eventId", 'partitionKey', "partitionKey", 'envelope', envelope,
  'payloadHash', "payloadHash", 'createdAtMs', (extract(epoch FROM "createdAt") * 1000)::bigint
) ORDER BY "partitionKey", (envelope->>'aggregateversion')::bigint)
FROM public.event_outbox;`).stdout)
}
function receive(mode, count) {
  // A fresh anonymous consumer reads the isolated topic; no shared group/reset.
  const result = kafka('kafka-console-consumer', ['--bootstrap-server', 'kafka:9092',
    '--topic', fixtureKafkaTopic(mode), '--from-beginning', '--max-messages', '256',
    '--timeout-ms', '15000', '--formatter-property', 'print.timestamp=true',
    '--formatter-property', 'print.partition=true', '--formatter-property', 'print.offset=true',
    '--formatter-property', 'print.headers=true', '--formatter-property', 'print.key=true',
    '--formatter-property', 'key.separator=\t'], { timeout: 60000, allowFailure: true })
  // Duplicates are allowed, not truncated at N. The pinned CLI can catch a
  // receive failure and exit zero, so require its exact idle-timeout outcome.
  assertBoundedConsumerExit(result, count)
  return result.stdout
}
function removeConnectorAndSlot(mode) {
  const name = connectorName(mode)
  const slot = slotName(mode)
  http(`/connectors/${name}`, { method: 'DELETE' })
  for (let attempt = 0; attempt < 30; attempt++) {
    const connectors = JSON.parse(http('/connectors').stdout)
    const state = dba(`SELECT CASE
      WHEN slot_type = 'logical' AND plugin = 'pgoutput' AND database = 'event_platform_test'
      THEN CASE WHEN active THEN 'active' ELSE 'inactive' END ELSE 'unexpected' END
      FROM pg_replication_slots WHERE slot_name = '${slot}';`).stdout.trim()
    if (state === 'unexpected') fail('refusing cleanup of an unexpected slot identity')
    if (!connectors.includes(name) && state === 'inactive') {
      // Exact validated test slot only; never a prod slot or a general slot loop.
      dba(`SELECT pg_drop_replication_slot('${slot}');`)
      activeMode = undefined
      return
    }
    pause(1000)
  }
  fail('test connector/slot cleanup deadline exceeded')
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.LD_EVENT_STACK_DISPOSABLE !== '1'
      || process.env.LD_EVENT_STACK_CDC !== '1') fail('explicit disposable GitHub CDC job required')
  if (!/^ld-event-test-[a-z0-9][a-z0-9-]{0,40}$/.test(project)) fail('isolated test project required')
  const config = JSON.parse(compose(['config', '--format', 'json']).stdout)
  assert.equal(config.services.postgres.environment.POSTGRES_DB, FIXTURE.database)
  assert.equal(config.services.postgres.environment.POSTGRES_USER, FIXTURE.adminRole)
  for (const service of Object.values(config.services)) {
    assert.equal((service.ports ?? []).length, 0)
    assert.ok((service.volumes ?? []).every(volume => volume.type !== 'bind'))
  }
  assert.ok(Object.values(config.networks).every(network => network.internal === true))
  assert.equal(dba('SELECT current_database();').stdout.trim(), FIXTURE.database)

  dba(bootstrapSql())
  // Apply every byte of the actual checked-in foundation as the real role split.
  psql(FIXTURE.migratorRole, FIXTURE.migratorPassword, readFileSync(foundation, 'utf8'))
  const migrationIdentity = dba(`SELECT tableowner FROM pg_tables
    WHERE schemaname='public' AND tablename='event_outbox';`).stdout.trim()
  assert.equal(migrationIdentity, FIXTURE.migratorRole)

  const smallWal = dba(readFileSync(prepareCdc, 'utf8'), { allowFailure: true })
  if (smallWal.status === 0 || !smallWal.stderr.includes('4096 MB')) fail('small WAL cap did not fail closed')
  assert.equal(dba("SELECT count(*) FROM pg_roles WHERE rolname='leaddrive_event_cdc';").stdout.trim(), '0')
  overrideActive = true
  compose(['up', '-d', '--no-deps', 'postgres'])
  let postgresReady = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = dba("SELECT setting FROM pg_settings WHERE name='max_slot_wal_keep_size';", { allowFailure: true })
    if (result.status === 0 && result.stdout.trim() === '4096') { postgresReady = true; break }
    pause(1000)
  }
  if (!postgresReady) fail('explicit finite test WAL configuration not active')
  dba(readFileSync(prepareCdc, 'utf8'))
  dba("ALTER ROLE leaddrive_event_cdc PASSWORD 'synthetic-cdc-only';")
  // Running preparation twice must retain the same narrow grants/publication.
  dba(readFileSync(prepareCdc, 'utf8'))
  const boundary = readFileSync(`${root}ops/event-platform/test/assert-cdc-boundary.sql`, 'utf8')
  dba(boundary)
  // Prove the metadata assertion rejects a real effective sequence grant;
  // syntax/planner errors must not count as a successful negative control.
  dba('CREATE SEQUENCE public.cdc_boundary_test_sequence; GRANT USAGE ON SEQUENCE public.cdc_boundary_test_sequence TO leaddrive_event_cdc;')
  const leakedSequence = dba(boundary, { allowFailure: true })
  assertDenied(leakedSequence, 'P0001')
  if (!leakedSequence.stderr.includes('CDC must not have effective public-sequence privileges')) fail('sequence-grant detector failed')
  dba('REVOKE ALL ON SEQUENCE public.cdc_boundary_test_sequence FROM leaddrive_event_cdc; DROP SEQUENCE public.cdc_boundary_test_sequence;')
  dba(boundary)

  assertDenied(psql(FIXTURE.cdcRole, 'deliberately-wrong-fixture-password', 'SELECT 1;', { allowFailure: true }), 'password authentication failed')
  assert.equal(psql(FIXTURE.cdcRole, FIXTURE.cdcPassword, 'SELECT current_user;').stdout.trim(), FIXTURE.cdcRole)
  psql(FIXTURE.appRole, FIXTURE.appPassword, phaseSql('snapshot'))
  assert.equal(psql(FIXTURE.cdcRole, FIXTURE.cdcPassword, 'SELECT count(DISTINCT "organizationId") FROM event_outbox;').stdout.trim(), '2')
  assert.equal(psql(FIXTURE.appRole, FIXTURE.appPassword,
    "BEGIN; SET LOCAL app.org_id='test-tenant-a'; SELECT count(*) FROM event_outbox; ROLLBACK;").stdout.trim(), '2')
  assert.equal(psql(FIXTURE.appRole, FIXTURE.appPassword, 'SELECT count(*) FROM event_outbox;').stdout.trim(), '0')
  for (const sql of ['SELECT * FROM domain_events;', 'SELECT * FROM organizations;',
    'INSERT INTO event_outbox DEFAULT VALUES;', 'UPDATE event_outbox SET "payloadHash"="payloadHash";',
    'DELETE FROM event_outbox;', 'TRUNCATE event_outbox;', 'SET ROLE event_app;']) {
    assertDenied(psql(FIXTURE.cdcRole, FIXTURE.cdcPassword, sql, { allowFailure: true }), '42501')
  }
  assertDenied(psql(FIXTURE.appRole, FIXTURE.appPassword, 'SET ROLE leaddrive_event_cdc;', { allowFailure: true }), '42501')
  process.stdout.write('cdc_sql_boundary=PASS\ncdc_test_wal_guard=PASS\n')

  for (const mode of allowedModes) {
    kafka('kafka-topics', ['--bootstrap-server', 'kafka:9092', '--create', '--topic', fixtureKafkaTopic(mode),
      '--partitions', '2', '--replication-factor', '1'])
    const connector = renderTestConnector(template, { mode })
    activeMode = mode
    http('/connectors', { method: 'POST', body: connector })
    waitConnector(mode)
    const snapshotRecords = receive(mode, 4)
    if (mode === 'expanded') {
      // Independent metadata/order evidence must not be hidden by an early
      // payload mismatch. This diagnostic reports the ORIGINAL parity defect;
      // it is never the raw candidate's strict acceptance gate.
      const comparison = compareExpandedCdcRecords(snapshotRecords, expectedRows())
      process.stdout.write(`cdc_legacy_expanded_comparison=${JSON.stringify(comparison)}\n`)
    } else {
      verifyCdcRecords(snapshotRecords, expectedRows())
      psql(FIXTURE.appRole, FIXTURE.appPassword, phaseSql('stream'))
      verifyCdcRecords(receive(mode, 6), expectedRows())
      const slotBefore = dba(`SELECT confirmed_flush_lsn IS NOT NULL FROM pg_replication_slots
        WHERE slot_name='${slotName(mode)}' AND slot_type='logical' AND plugin='pgoutput'
        AND database='event_platform_test';`).stdout.trim()
      assert.equal(slotBefore, 't')
      // Cold worker restart: keep config/offset/status topics, connector name,
      // replication slot and PG volume. Insert v4 while Connect is stopped.
      compose(['stop', '--timeout', '10', 'connect'])
      psql(FIXTURE.appRole, FIXTURE.appPassword, phaseSql('restart'))
      compose(['start', 'connect'])
      waitConnect()
      waitConnector(mode)
      const summary = verifyCdcRecords(receive(mode, 8), expectedRows())
      assert.equal(summary.uniqueEvents, 8)
      assert.equal(summary.keys, 2)
      process.stdout.write(`cdc_raw_transport=${JSON.stringify(summary)}\ncdc_cold_restart=PASS\n`)
    }
    removeConnectorAndSlot(mode)
  }
  assert.equal(dba('SELECT count(*) FROM pg_replication_slots;').stdout.trim(), '0')
  process.stdout.write('cdc_fixture_scope=synthetic-transport-only\ncdc_fixture_tls=NOT_PROVEN\ncdc_business_projection=NOT_RUN\ncdc_production_activation=NOT_RUN\ncdc_smoke=PASS\n')
}

try { await main() } catch (error) {
  process.stderr.write(`${error.message}\n`)
  // The outer CI harness always removes this exact disposable Compose
  // project, including its anonymous PG volume and test slots. Never fall
  // back to a host DB, production alias or a wildcard slot/drop operation.
  if (activeMode) process.stderr.write(`Disposable CDC: ${activeMode} cleanup delegated to isolated project teardown\n`)
  process.exitCode = 1
}
