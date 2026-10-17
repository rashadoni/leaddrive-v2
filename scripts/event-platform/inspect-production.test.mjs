import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./inspect-production.sh', import.meta.url))

async function parse(content) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ld-inventory-test-'))
  const env = path.join(directory, 'fixture.env')
  await writeFile(env, content, { mode: 0o600 })
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c',
    'source "$1"; read_static_env_value "$2" MIGRATION_DATABASE_URL', 'test', script, env], { encoding: 'utf8' })
  await rm(directory, { recursive: true })
  return result
}

test('parses quoted static values without running production inventory', async () => {
  const result = await parse('# ignored\r\n export MIGRATION_DATABASE_URL = "postgresql://synthetic:only@localhost/test"\r\n')
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'postgresql://synthetic:only@localhost/test')
})

test('rejects duplicate entries even if their values match', async () => {
  const result = await parse('MIGRATION_DATABASE_URL=a\nMIGRATION_DATABASE_URL=a\n')
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
})

test('rejects absent and empty values', async () => {
  for (const content of ['OTHER=value\n', 'MIGRATION_DATABASE_URL=""\n']) {
    const result = await parse(content)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('does not execute command substitutions or unrelated shell statements', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ld-no-eval-test-'))
  const sentinel = path.join(directory, 'must-not-exist')
  try {
    const payload = `$(touch ${sentinel})`
    const result = await parse(`touch ${sentinel}\nMIGRATION_DATABASE_URL='${payload}'\n`)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, payload)
    await assert.rejects(access(sentinel))
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('direct invocation fails before host access without a full approved SHA', () => {
  const result = spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: process.env.PATH, EXPECTED_DEPLOY_SHA: 'short' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /expected SHA required/)
  assert.doesNotMatch(result.stdout, /postgresql:|host_Mem|inventory=PASS/)
})

test('connection credentials never enter psql argv and read-only options are forced', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ld-psql-argv-test-'))
  const fakePsql = path.join(directory, 'psql')
  await writeFile(fakePsql, '#!/usr/bin/env python3\nimport os,sys,json\nprint(json.dumps({"args":sys.argv[1:],"host":os.environ["PGHOST"],"user":os.environ["PGUSER"],"passwordMatches":os.environ["PGPASSWORD"]=="synthetic:secret","options":os.environ["PGOPTIONS"],"urlKept":"LD_INSPECTION_DATABASE_URL" in os.environ}))\n', { mode: 0o700 })
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c',
      'source "$1"; run_readonly_psql "$2"', 'test', script,
      'postgresql://fixture:synthetic%3Asecret@localhost:5432/test?sslmode=verify-full'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.deepEqual(output.args, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'])
    assert.equal(output.host, 'localhost')
    assert.equal(output.user, 'fixture')
    assert.equal(output.passwordMatches, true)
    assert.equal(output.urlKept, false)
    assert.match(output.options, /default_transaction_read_only=on/)
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('rejects connection option overrides instead of weakening read-only inspection', () => {
  for (const query of ['options=-c%20default_transaction_read_only=off', 'host=other-host', 'sslmode=require&sslmode=disable', 'target_session_attrs=read-write']) {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c',
      'source "$1"; run_readonly_psql "$2"', 'test', script, `postgresql://localhost/test?${query}`], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /unsupported inspection connection configuration/)
  }
})
