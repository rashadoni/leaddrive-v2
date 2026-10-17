import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const script = `${root}scripts/event-platform/test-cdc.mjs`
const source = readFileSync(script, 'utf8')

test('CDC executable refuses non-CI and broad project names before Docker', () => {
  for (const env of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_ACTIONS: 'true', LD_EVENT_STACK_DISPOSABLE: '1', LD_EVENT_STACK_CDC: '0' },
    { GITHUB_ACTIONS: 'true', LD_EVENT_STACK_DISPOSABLE: '1', LD_EVENT_STACK_CDC: '1', LD_EVENT_STACK_PROJECT: 'production' },
  ]) {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /explicit disposable GitHub CDC job required|isolated test project required/)
    assert.doesNotMatch(result.stderr, /bounded Docker command failed/)
  }
})

test('explicit CDC override changes only the finite disposable WAL ceiling', () => {
  const config = (...files) => JSON.parse(execFileSync('docker', ['compose', '-p', 'ld-event-test-validation',
    ...files.flatMap(file => ['-f', `${root}ops/event-platform/test/${file}`]), 'config', '--format', 'json'], { encoding: 'utf8' }))
  const base = config('compose.yml')
  const cdc = config('compose.yml', 'cdc.compose.yml')
  const expected = structuredClone(base)
  expected.services.postgres.command = expected.services.postgres.command.map(value => value === 'max_slot_wal_keep_size=64MB' ? 'max_slot_wal_keep_size=4096MB' : value)
  assert.deepEqual(cdc, expected)
})

test('drill applies the full real migration and rejects the small cap without weakening CDC SQL', () => {
  assert.match(source, /20260901090000_event_platform_foundation\/migration\.sql/)
  assert.match(source, /psql\(FIXTURE\.migratorRole, FIXTURE\.migratorPassword, readFileSync\(foundation, 'utf8'\)\)/)
  assert.match(source, /const smallWal = dba\(readFileSync\(prepareCdc, 'utf8'\), \{ allowFailure: true \}\)/)
  assert.match(source, /smallWal\.stderr\.includes\('4096 MB'\)/)
  assert.doesNotMatch(source, /\bsed\s|replace\([^\n]*4096|ALTER SYSTEM|DISABLE TRIGGER|session_replication_role|spawnSync\('ssh'/)
  assert.match(source, /cdc_fixture_tls=NOT_PROVEN/)
  assert.match(source, /cdc_business_projection=NOT_RUN/)
})

test('restart retains topic and slot authority and cleanup names only exact test slots', () => {
  const stop = source.indexOf("compose(['stop', '--timeout', '10', 'connect'])")
  const offlineWrite = source.indexOf("phaseSql('restart')")
  const start = source.indexOf("compose(['start', 'connect'])")
  assert.ok(stop > 0 && stop < offlineWrite && offlineWrite < start)
  assert.match(source, /slot_type = 'logical' AND plugin = 'pgoutput' AND database = 'event_platform_test'/)
  assert.match(source, /if \(state === 'unexpected'\) fail/)
  assert.match(source, /!connectors\.includes\(name\) && state === 'inactive'/)
  assert.match(source, /pg_drop_replication_slot\('\$\{slot\}'\)/)
  assert.doesNotMatch(source, /--reset-offsets|pg_replication_slot_advance|kafka-delete-records|--delete.*topic|offsets\/reset/)
  assert.match(source, /max-messages', '256'/)
})

test('sequence privilege assertion filters relation kinds before invoking sequence-only functions', () => {
  const sql = readFileSync(`${root}ops/event-platform/test/assert-cdc-boundary.sql`, 'utf8')
  assert.match(sql, /FOR relation IN\s+SELECT c\.oid[^;]*c\.relkind = 'S'\s+LOOP\s+IF has_sequence_privilege\(cdc_oid, relation\.oid,/)
  assert.match(source, /const leakedSequence = dba\(boundary, \{ allowFailure: true \}\)/)
  assert.match(source, /assertDenied\(leakedSequence, 'P0001'\)/)
  assert.match(source, /leakedSequence\.stderr\.includes\('CDC must not have effective public-sequence privileges'\)/)
})
