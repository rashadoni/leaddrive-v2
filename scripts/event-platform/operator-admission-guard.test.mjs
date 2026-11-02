/** Negative route-guard tests only: psql/Docker/DB are never invoked here. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const runner = new URL('./operator-admission.integration.mjs', import.meta.url)
const environment = { GITHUB_ACTIONS: 'true', LD_OPERATOR_DISPOSABLE: '1',
  PGDATABASE: 'kafka_operator_test', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'control_test_admin',
  PATH: '/nonexistent-no-psql' }

test('final ready-for-review event executes the real operator SQL gate again', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/kafka-operator-admission.yml', import.meta.url), 'utf8')
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/)
  assert.match(workflow, /run: node --test scripts\/event-platform\/operator-admission\.integration\.mjs/)
  assert.doesNotMatch(workflow, /continue-on-error:/)
})

test('operator SQL fixture rejects non-CI, ambiguous and non-loopback routes before SQL', () => {
  const invalid = [
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: 'false' }, { LD_OPERATOR_DISPOSABLE: undefined },
    { PGDATABASE: 'production' }, { PGHOST: '192.0.2.1' }, { PGUSER: 'postgres' },
    { PGPORT: undefined }, { PGPORT: '0' }, { PGPORT: '65536' }, { PGPORT: '5432,5433' },
    { PGHOSTADDR: '192.0.2.1' }, { PGSERVICE: 'production' }, { PGSERVICEFILE: '/nonexistent-service' },
  ]
  for (const change of invalid) {
    const result = spawnSync(process.execPath, [runner.pathname], {
      env: { ...environment, ...change }, encoding: 'utf8', timeout: 5000,
    })
    assert.notEqual(result.status, null, 'guard must terminate, not time out')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /OPERATOR_FIXTURE_ADMISSION_DENIED/)
    assert.doesNotMatch(result.stderr, /ENOENT|fixture SQL rejected|spawn psql/)
  }
})
