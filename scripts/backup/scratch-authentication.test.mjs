import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

const source = readFileSync(new URL('./postgres-restore-canary.sh', import.meta.url), 'utf8')
const target = 'leaddrive_restore_verify_20261020_020304_1234'
const env = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', LC_ALL: 'C' }
function extract(name) {
  const match = [...source.matchAll(new RegExp('^' + name + '\\(\\) \\{\\n[\\s\\S]*?^\\}', 'gm'))]
  assert.equal(match.length, 1, name)
  return match[0][0]
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-synthetic-auth-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function prepare(root, payload, options = {}) {
  const work = join(root, 'private'), input = join(root, 'canonical.pgpass')
  mkdirSync(work, { mode: options.workMode ?? 0o700 })
  chmodSync(work, options.workMode ?? 0o700)
  writeFileSync(input, payload, { mode: options.inputMode ?? 0o600 })
  chmodSync(input, options.inputMode ?? 0o600)
  let path = work
  if (options.alias) { symlinkSync(work, join(root, 'alias')); path = join(root, 'alias') }
  const before = readFileSync(input), state = statSync(input)
  const workModeBefore = statSync(work).mode & 0o777
  const script = `set -Eeuo pipefail
umask 077
TMPDIR="$TEST_WORK"
${['fatal', 'assert_connection_file', 'prepare_run_verifier_passfile'].map(extract).join('\n')}
findmnt() { printf '%s\\n' "$TEST_FS"; }
${options.output ? 'mktemp() { printf "%s\\n" "$TEST_OUTPUT"; }' : ''}
RUN_VERIFY_PGPASS=""
prepare_run_verifier_passfile
printf 'PATH=%s\\n' "$RUN_VERIFY_PGPASS"
`
  const result = spawnSync('bash', ['-c', script], { env: { ...env, TEST_WORK: path,
    VERIFY_PGPASSFILE: input, VERIFY_PGHOST: options.host ?? '127.0.0.1', VERIFY_PGPORT: '55432',
    VERIFY_PGMAINTENANCE_DB: 'postgres', VERIFY_PGUSER: 'leaddrive_restore_verifier', SCRATCH_DB: options.target ?? target,
    TEST_FS: options.filesystem ?? 'tmpfs', TEST_OUTPUT: options.output ?? '',
  }, encoding: 'utf8', timeout: 5000 })
  assert.deepEqual(readFileSync(input), before, 'canonical secret bytes must never change')
  assert.equal(statSync(input).mode, state.mode)
  return { result, work, workModeBefore, output: result.stdout.startsWith('PATH=') ? result.stdout.trim().slice(5) : undefined }
}

test('maintenance-only credential derives two exact DB entries in private workspace; canonical unchanged', () => fixture(root => {
  const secret = 'synthetic-é\\:colon\\\\backslash'
  const prefix = '127.0.0.1:55432:'
  const { result, output } = prepare(root, `${prefix}postgres:leaddrive_restore_verifier:${secret}\n`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(statSync(output).mode & 0o777, 0o600)
  assert.deepEqual(readFileSync(output), Buffer.from(
    `${prefix}postgres:leaddrive_restore_verifier:${secret}\n${prefix}${target}:leaddrive_restore_verifier:${secret}\n`))
  assert(!result.stdout.includes(secret))
}))

test('existing wildcard authority narrows to exact host/port/user and only this canary DB', () => fixture(root => {
  const { result, output } = prepare(root, '# Comment\n*:*:*:*:synthetic-password\n')
  assert.equal(result.status, 0, result.stderr)
  const lines = readFileSync(output, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert(lines.every(line => line.startsWith('127.0.0.1:55432:') && !line.includes('*')))
  assert(lines[1].includes(':' + target + ':leaddrive_restore_verifier:'))
}))

test('escaped IPv6 header and read-only canonical input preserve exact password escaping', () => fixture(root => {
  const { result, output } = prepare(root, '\\:\\:1:55432:postgres:leaddrive_restore_verifier:synthetic\\:pw\\\\tail\n', { host: '::1', inputMode: 0o400 })
  assert.equal(result.status, 0, result.stderr)
  assert(readFileSync(output, 'utf8').includes(`\\:\\:1:55432:${target}:leaddrive_restore_verifier:synthetic\\:pw\\\\tail\n`))
}))

test('ambiguous, missing, malformed, binary, CR or oversized authentication refuses without secret output', () => {
  const entry = '127.0.0.1:55432:postgres:leaddrive_restore_verifier:SYNTHETIC_SECRET_DO_NOT_PRINT\n'
  for (const payload of [entry + entry, entry.replace('55432', '5432'), entry.replace('postgres', 'other'),
    'broken', entry.replace('\n', '\r\n'), entry + '\0', entry.repeat(1000), entry.replace('SYNTHETIC_SECRET_DO_NOT_PRINT', '')]) fixture(root => {
    const { result, work } = prepare(root, payload)
    assert.notEqual(result.status, 0)
    assert(!result.stdout.includes('SYNTHETIC_SECRET'))
    assert(!result.stderr.includes('SYNTHETIC_SECRET'))
    for (const file of readdirSync(work)) assert.equal(statSync(join(work, file)).size, 0)
  })
})

test('wrong tmpfs/ownership-mode/canonical path and target injection refuse before generating auth', () => {
  for (const options of [{ filesystem: 'ext4' }, { workMode: 0o777 }, { alias: true }, { inputMode: 0o644 },
    { target: 'postgres' }, { target: target + ';echo unsafe' }]) fixture(root => {
    const { result, work, workModeBefore } = prepare(root, '*:*:*:*:synthetic\n', options)
    assert.notEqual(result.status, 0, JSON.stringify({ options, workModeBefore, after: statSync(work).mode & 0o777 }))
    assert.deepEqual(readdirSync(work), [])
  })
})

test('unsafe existing output, symlink and hardlink cannot truncate a foreign file', () => {
  for (const kind of ['nonempty', 'symlink', 'hardlink']) fixture(root => {
    const foreign = join(root, 'foreign'), output = join(root, 'output')
    writeFileSync(foreign, 'preserve-public-fixture', { mode: 0o600 })
    if (kind === 'symlink') symlinkSync(foreign, output)
    else if (kind === 'hardlink') linkSync(foreign, output)
    else writeFileSync(output, 'preserve-output', { mode: 0o600 })
    const before = readFileSync(output)
    const { result } = prepare(root, '*:*:*:*:synthetic\n', { output })
    assert.notEqual(result.status, 0)
    assert.deepEqual(readFileSync(output), before)
    assert.equal(readFileSync(foreign, 'utf8'), 'preserve-public-fixture')
  })
})

test('cleanup SQL is stdin-interpolated, not an unexpanded psql -c variable expression', () => fixture(root => {
  const result = spawnSync('bash', ['-c', `set -euo pipefail
${extract('confirm_scratch_database_absent')}
psql() { printf '%s\\n' "$@" >"$TEST_ROOT/args"; command tee "$TEST_ROOT/sql" >/dev/null; printf '0\\n'; }
env() { while [[ "$1" = *=* ]]; do shift; done; "$@"; }
VERIFY_ENV=()
SCRATCH_DB="$TEST_DB"
VERIFY_PGMAINTENANCE_DB=postgres
confirm_scratch_database_absent
`], { env: { ...env, TEST_ROOT: root, TEST_DB: target }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '0\n')
  assert(!readFileSync(join(root, 'args'), 'utf8').split('\n').includes('-c'))
  assert.equal(readFileSync(join(root, 'sql'), 'utf8'), "SELECT count(*) FROM pg_database WHERE datname = :'candidate';\n")
  assert(existsSync(join(root, 'args')))
}))

test('actual verifier environment clears inherited source route without changing source or TLS authority', () => {
  const result = spawnSync('bash', ['-c', `set -Eeuo pipefail
${extract('configure_verifier_environment')}
VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT=55432 VERIFY_PGUSER=fixture_verifier
VERIFY_PGPASSFILE=/fixture/canonical VERIFY_PGCONNECT_TIMEOUT=3 VERIFY_PGSSLMODE=verify-full
VERIFY_PGSSLROOTCERT=/fixture/independent-scratch-ca
RUN_VERIFY_PGPASS=""
configure_verifier_environment
env "${'$'}{VERIFY_ENV[@]}" node -e 'console.log(JSON.stringify({route:process.env.PGHOSTADDR,host:process.env.PGHOST,pass:process.env.PGPASSFILE,ca:process.env.PGSSLROOTCERT,ssl:process.env.PGSSLMODE}))'
RUN_VERIFY_PGPASS=/fixture/one-run
configure_verifier_environment
env "${'$'}{VERIFY_ENV[@]}" node -e 'console.log(JSON.stringify({route:process.env.PGHOSTADDR,pass:process.env.PGPASSFILE}))'
[ "$PGHOSTADDR" = 203.0.113.42 ] && [ "$PGHOST" = fixture-source ]
`], { env: { ...env, PGHOSTADDR: '203.0.113.42', PGHOST: 'fixture-source' }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(lines, [
    { route: '', host: '127.0.0.1', pass: '/fixture/canonical', ca: '/fixture/independent-scratch-ca', ssl: 'verify-full' },
    { route: '', pass: '/fixture/one-run' },
  ])
})

test('real networkless PostgreSQL: maintenance-only auth fails on target, per-run exact auth succeeds, cleanup proves absence', {
  skip: process.env.LEADDRIVE_TEST_NATIVE_AUTH === '1' ? false : 'requires isolated hosted Docker PostgreSQL16; never run native services on DEV',
}, () => {
  assert.equal(process.getuid(), 0)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert(existsSync('/.dockerenv'))
  assert(Object.keys(networkInterfaces()).every(name => name === 'lo'))
  assert.equal(readFileSync('/sys/fs/cgroup/memory.swap.max', 'utf8').trim(), '0')
  const data = '/database/native-auth-cluster'
  assert(!existsSync(data), 'never acquire an existing database')
  const root = mkdtempSync('/scratch/native-auth-')
  const work = join(root, 'private'), canonical = join(root, 'canonical.pgpass')
  const password = 'public-synthetic-auth-fixture-not-a-real-credential'
  const pgEnv = { PATH: process.env.PATH, LC_ALL: 'C', PGHOST: '127.0.0.1', PGPORT: '55432',
    PGUSER: 'leaddrive_restore_verifier', PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3', PGPASSFILE: canonical }
  const command = (program, args, extra = {}) => spawnSync(program, args, {
    env: { PATH: process.env.PATH, LC_ALL: 'C' }, encoding: 'utf8', timeout: 30000, maxBuffer: 65536, ...extra,
  })
  const ok = result => assert.equal(result.status, 0, 'synthetic fixture command failed: ' + result.stderr)
  const admin = sql => command('gosu', ['postgres', 'psql', '-X', '-h', data, '-p', '55432', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql })
  let started = false
  try {
    mkdirSync(data, { mode: 0o700 })
    const uid = Number(command('id', ['-u', 'postgres']).stdout.trim())
    const gid = Number(command('id', ['-g', 'postgres']).stdout.trim())
    assert(Number.isInteger(uid) && uid > 0 && Number.isInteger(gid) && gid > 0)
    chownSync(data, uid, gid)
    ok(command('gosu', ['postgres', 'initdb', '-D', data, '-A', 'trust', '-U', 'postgres', '--no-instructions']))
    writeFileSync(join(data, 'pg_hba.conf'), 'local all all trust\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all ::1/128 reject\n', { mode: 0o600 })
    chownSync(join(data, 'pg_hba.conf'), uid, gid)
    ok(command('gosu', ['postgres', 'pg_ctl', '-D', data, '-l', join(data, 'server.log'), '-o', '-h 127.0.0.1 -p 55432 -k ' + data, '-w', 'start']))
    started = true
    ok(admin(`CREATE ROLE leaddrive_restore_verifier LOGIN NOSUPERUSER NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\nCREATE DATABASE auth_outsider;\n`))
    mkdirSync(work, { mode: 0o700 })
    writeFileSync(canonical, `127.0.0.1:55432:postgres:leaddrive_restore_verifier:${password}\n`, { mode: 0o600 })
    const before = readFileSync(canonical)
    ok(command('createdb', ['--maintenance-db=postgres', target], { env: pgEnv }))
    const denied = command('psql', ['-X', '-w', '-At', '-c', 'SELECT 1'], { env: { ...pgEnv, PGDATABASE: target } })
    assert.notEqual(denied.status, 0, 'maintenance-only canonical entry must not authenticate a dynamic DB')
    const derived = command('bash', ['-c', `set -Eeuo pipefail
umask 077
TMPDIR="$TEST_WORK"
${['fatal', 'assert_connection_file', 'prepare_run_verifier_passfile'].map(extract).join('\n')}
RUN_VERIFY_PGPASS=""
prepare_run_verifier_passfile
printf 'PATH=%s\\n' "$RUN_VERIFY_PGPASS"
`], { env: { ...pgEnv, TEST_WORK: work, VERIFY_PGPASSFILE: canonical, VERIFY_PGHOST: pgEnv.PGHOST,
      VERIFY_PGPORT: pgEnv.PGPORT, VERIFY_PGUSER: pgEnv.PGUSER, VERIFY_PGMAINTENANCE_DB: 'postgres', SCRATCH_DB: target } })
    ok(derived)
    assert(derived.stdout.startsWith('PATH='))
    const output = derived.stdout.trim().slice(5)
    assert(output.startsWith(work + '/'))
    const exact = { ...pgEnv, PGPASSFILE: output }
    const connected = command('psql', ['-X', '-w', '-At', '-c', 'SELECT 1'], { env: { ...exact, PGDATABASE: target } })
    ok(connected)
    assert.equal(connected.stdout.trim(), '1')
    assert.notEqual(command('psql', ['-X', '-w', '-At', '-c', 'SELECT 1'], { env: { ...exact, PGDATABASE: 'auth_outsider' } }).status, 0)
    // Prove the former cleanup query really fails with psql -c, independently
    // of mocks, before exercising the actual stdin-bound cleanup function.
    assert.notEqual(command('psql', ['-X', '-w', '-v', 'candidate=' + target, '-At', '-c', "SELECT count(*) FROM pg_database WHERE datname = :'candidate'"], { env: exact }).status, 0)
    const empty = ['RESTORED_CANARY', 'SOURCE_SECURITY', 'RESTORED_SECURITY', 'RESTORED_MIGRATION_LEDGER', 'RESTORED_APPLIED_MIGRATIONS', 'CONTRACT_MIGRATIONS', 'EXPECTED_APPLIED_MIGRATIONS'].map(key => key + '=""').join('\n')
    const retired = command('bash', ['-c', `set -Eeuo pipefail
${['confirm_scratch_database_absent', 'configure_verifier_environment', 'cleanup'].map(extract).join('\n')}
VERIFY_PGMAINTENANCE_DB=postgres
SCRATCH_DB="$TEST_DB"
SCRATCH_DB_CREATED=1
RUN_VERIFY_PGPASS="$PGPASSFILE"
configure_verifier_environment
${empty}
trap cleanup EXIT
exit 0
`], { env: { ...exact, PGHOSTADDR: '203.0.113.42', TEST_DB: target,
      VERIFY_PGHOST: pgEnv.PGHOST, VERIFY_PGPORT: pgEnv.PGPORT, VERIFY_PGUSER: pgEnv.PGUSER,
      VERIFY_PGPASSFILE: canonical, VERIFY_PGSSLMODE: 'disable', VERIFY_PGCONNECT_TIMEOUT: '3' } })
    ok(retired)
    assert(!existsSync(output), 'actual cleanup must remove only its derived auth file')
    assert.deepEqual(readFileSync(canonical), before)
    assert.equal(admin(`SELECT count(*) FROM pg_database WHERE datname = '${target}';\n`).stdout.trim(), '0')
    assert.equal(admin("SELECT count(*) FROM pg_database WHERE datname = 'auth_outsider';\n").stdout.trim(), '1')
  } finally {
    if (started) ok(command('gosu', ['postgres', 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop']))
    rmSync(data, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
