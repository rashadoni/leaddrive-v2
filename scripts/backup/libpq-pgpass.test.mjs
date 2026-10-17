import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Opt-in, disposable CI service only. Never inherit production PG credentials.
const enabled = process.env.GITHUB_ACTIONS === 'true'
  && process.env.LEADDRIVE_PGPASS_INTEGRATION === '1'

test('real libpq accepts private passfiles and ignores group/world-readable ones', { skip: !enabled }, async () => {
  const port = process.env.TESTPG_PORT
  assert.match(port ?? '', /^\d+$/)
  assert.ok(Number(port) >= 1024 && Number(port) <= 65535)
  const directory = await mkdtemp(path.join(tmpdir(), 'leaddrive-pgpass-ci-'))
  const passfile = path.join(directory, 'synthetic.pgpass')
  const line = `127.0.0.1:${port}:pgpass_contract_test:contract_fixture:only_synthetic_fixture\n`
  const env = {
    PATH: process.env.PATH,
    PGHOST: '127.0.0.1', PGPORT: port,
    PGDATABASE: 'pgpass_contract_test', PGUSER: 'contract_fixture',
    PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGPASSFILE: passfile,
  }
  const connect = () => spawnSync('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT current_user'], {
    env, encoding: 'utf8', timeout: 10_000,
  })
  try {
    await writeFile(passfile, line, { mode: 0o600 })
    for (const mode of [0o400, 0o600]) {
      await chmod(passfile, mode)
      const result = connect()
      assert.equal(result.status, 0, `private mode ${mode.toString(8)} must authenticate with libpq`)
      assert.equal(result.stdout.trim(), 'contract_fixture')
    }
    for (const mode of [0o440, 0o640, 0o644]) {
      await chmod(passfile, mode)
      const result = connect()
      assert.notEqual(result.status, 0, `mode ${mode.toString(8)} must not authenticate`)
      assert.match(result.stderr, /no password supplied/, 'failure must be due to ignored passfile, not unavailable DB')
    }
    await chmod(passfile, 0o600)
    await writeFile(passfile, line.replace('only_synthetic_fixture', 'deliberately_wrong_fixture'))
    const wrongPassword = connect()
    assert.notEqual(wrongPassword.status, 0)
    assert.match(wrongPassword.stderr, /password authentication failed/, 'server must require password authentication, not trust')
  } finally {
    await rm(directory, { recursive: true })
  }
})
