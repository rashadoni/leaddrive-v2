import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'

const source = readFileSync(new URL('./commission-production-backup.sh', import.meta.url), 'utf8')
const env = { PATH: '/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' }
function extract(name) {
  const found = [...source.matchAll(new RegExp('^' + name + '\\(\\) \\{\\n[\\s\\S]*?^\\}', 'gm'))]
  assert.equal(found.length, 1, name)
  return found[0][0]
}
const functions = ['fatal', 'log', 'trim_value', 'read_static_env_value', 'read_unique_value_from', 'read_unique_value',
  'require_static_value', 'assert_root_file', 'assert_root_directory', 'scratch_control_state', 'assert_scratch_port_free',
  'scratch_connection_query', 'admit_commission_scratch', 'start_commission_scratch', 'stop_commission_scratch']
const definitions = functions.map(extract).join('\n')
const globals = `WORKFLOW_RUN_ID="$TEST_RUN_ID"
BACKUP_ENV_FILE=/etc/leaddrive/backup.env
SCRATCH_UNIT="" SCRATCH_DESCRIPTION="" SCRATCH_INVOCATION="" SCRATCH_SYSTEM_IDENTIFIER="" SCRATCH_LOCK_HELD=0
`
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-scratch-policy-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function shell(program, extra = {}) {
  return spawnSync('bash', ['-c', 'set -Eeuo pipefail\n' + program], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 })
}

test('exact lifecycle launch has fixed distinct storage, narrow network and hard resource/expiry ceilings', () => fixture(root => {
  const result = shell(definitions + '\n' + globals + `
admit_commission_scratch() { SCRATCH_LOCK_HELD=1; SCRATCH_SYSTEM_IDENTIFIER=123; }
systemctl() {
  case "$*" in *LoadState*) echo not-found;; *InvocationID*) echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; *ActiveState*) echo active;; *) exit 91;; esac
}
systemd-run() { printf '%s\\n' "$@" >"$TEST_ROOT/argv"; }
scratch_connection_query() { echo '123|55432|0|1|0|0|0|1|0|0|1|0'; }
start_commission_scratch
`, { TEST_RUN_ID: '123456789', TEST_ROOT: root })
  assert.equal(result.status, 0, result.stderr)
  const args = readFileSync(join(root, 'argv'), 'utf8').trim().split('\n')
  for (const required of ['--uid=postgres', '--gid=postgres', '--property=Type=exec', '--property=MemoryMax=1073741824',
    '--property=MemoryHigh=805306368', '--property=MemorySwapMax=0', '--property=RuntimeMaxSec=14520',
    '--property=TimeoutStopSec=60', '--property=KillSignal=SIGINT', '--property=KillMode=mixed',
    '--property=ReadWritePaths=/var/lib/postgresql/16/leaddriverestore', '--property=ProtectSystem=strict',
    '--property=PrivateIPC=yes', 'listen_addresses=127.0.0.1', 'port=55432', 'ssl=on',
    'data_directory=/var/lib/postgresql/16/leaddriverestore', 'shared_preload_libraries=', 'restore_command=',
    'ssl_passphrase_command=', 'archive_library=', 'dynamic_shared_memory_type=mmap']) assert(args.includes(required), required)
  assert(!args.some(a => /EnvironmentFile|enable|pg_ctlcluster|pg_dropcluster|apt|remount/.test(a)))
}))

test('target query uses env-i, limited identity and fixed TLS route without inherited source credentials', () => fixture(root => {
  const result = shell(extract('scratch_connection_query') + `
env() { printf '%s\\n' "$@" >"$TEST_ROOT/environment"; shift; while [[ "$1" = *=* ]]; do shift; done; "$@"; }
timeout() { printf '%s\\n' "$@" >"$TEST_ROOT/timeout"; shift; "$@"; }
runuser() { printf '%s\\n' "$@" >"$TEST_ROOT/query"; }
scratch_connection_query scratch 'SELECT 1'
`, { TEST_ROOT: root, PGHOSTADDR: '203.0.113.42', PGPASSWORD: 'public-fixture-do-not-inherit', PGOPTIONS: '-c dangerous=1' })
  assert.equal(result.status, 0, result.stderr)
  const args = readFileSync(join(root, 'environment'), 'utf8').split('\n')
  for (const value of ['leaddrive-backup', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'PGHOSTADDR=127.0.0.1', 'PGSSLMODE=verify-full',
    'PGSSLROOTCERT=/etc/leaddrive/restore-postgres-ca.crt', 'PGUSER=leaddrive_restore_verifier', '-w']) assert(args.includes(value), value)
  assert(!args.some(v => /203\.0\.113|do-not-inherit|dangerous/.test(v)))
  const timeoutArgs = readFileSync(join(root, 'timeout'), 'utf8').split('\n')
  assert(!timeoutArgs.some(v => v.startsWith('PG') || v === 'env' || v === '-i'))
  assert(!/timeout[^\n]*env -i/.test(source))
}))

test('cleanup refuses a different description or invocation and never stops an unowned unit', () => {
  for (const mismatch of ['description', 'invocation']) fixture(root => {
    const result = shell(extract('stop_commission_scratch') + `
WORKFLOW_RUN_ID=123 SCRATCH_UNIT=leaddrive-restore-scratch-123.service SCRATCH_LOCK_HELD=1
SCRATCH_DESCRIPTION=owned SCRATCH_INVOCATION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
systemctl() {
 case "$*" in *LoadState*) echo loaded;; *Description*) echo "$TEST_DESCRIPTION";; *InvocationID*) echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;; stop*) touch "$TEST_ROOT/stopped";; *) exit 90;; esac
}
stop_commission_scratch
`, { TEST_ROOT: root, TEST_DESCRIPTION: mismatch === 'description' ? 'foreign' : 'owned' })
    assert.notEqual(result.status, 0)
    assert(!existsSync(join(root, 'stopped')))
  })
})

test('cleanup proves clean same-cluster shutdown; unknown listener/control state is not success', () => {
  for (const mode of ['clean', 'listener', 'identity', 'crashed']) fixture(root => {
    const result = shell(extract('stop_commission_scratch') + `
log() { :; }
WORKFLOW_RUN_ID=123 SCRATCH_UNIT=leaddrive-restore-scratch-123.service SCRATCH_LOCK_HELD=1
SCRATCH_DESCRIPTION=owned SCRATCH_INVOCATION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa SCRATCH_SYSTEM_IDENTIFIER=123
systemctl() {
 case "$*" in *LoadState*) echo loaded;; *Description*) echo owned;; *InvocationID*) echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; stop*|reset-failed*) :;; *) exit 90;; esac
}
assert_scratch_port_free() { [ "$TEST_MODE" != listener ]; }
scratch_control_state() { case "$TEST_MODE" in identity) echo '456|shut down';; crashed) echo '123|in production';; *) echo '123|shut down';; esac; }
stop_commission_scratch
[ -z "$SCRATCH_UNIT" ]
`, { TEST_MODE: mode, TEST_ROOT: root })
    assert.equal(result.status === 0, mode === 'clean', mode)
  })
})

test('port probe failure and any existing listener refuse admission', () => {
  for (const body of ['return 1', "echo 'LISTEN 127.0.0.1:55432'", ':']) {
    const result = shell(extract('assert_scratch_port_free') + '\nss() { ' + body + '; }\nassert_scratch_port_free')
    assert.equal(result.status === 0, body === ':')
  }
})

test('controller starts scratch before dump, stops after database worker and keeps failure fence', () => {
  const run = extract('run_verified_backup'), cleanup = extract('cleanup')
  assert(run.indexOf('\n  start_commission_scratch\n') < run.indexOf('\n  run_transient_backup_unit database '))
  assert(run.indexOf('\n  stop_commission_scratch ') < run.indexOf('\n  run_transient_backup_unit secrets '))
  assert(cleanup.indexOf('if [ -n "$ACTIVE_TRANSIENT_UNIT" ]') < cleanup.indexOf('stop_commission_scratch'))
  assert(cleanup.includes('[ "$scratch_cleanup_failed" -eq 0 ]'))
  assert(extract('run_transient_backup_unit').includes('--property=RuntimeMaxSec="$timeout_seconds"'))
  const admit = extract('admit_commission_scratch')
  for (const guard of ['flock -n 4', 'start.conf', 'postgresql.auto.conf', 'postmaster.pid', 'standby.signal', 'recovery.signal',
    'pg_tblspc', 'pg_hba.conf', 'VERIFY_PGSSLMODE:verify-full', 'source identity query failed', 'shut\\ down']) assert(admit.includes(guard), guard)
  assert(admit.indexOf('flock -n 4') < admit.indexOf('"$data" "$config"'))
})

test('genuine hosted two-cluster TLS lifecycle, source preservation and failure cleanup', {
  skip: process.env.LEADDRIVE_TEST_REAL_SCRATCH === '1' ? false : 'requires isolated hosted Ubuntu24 PG16/systemd; never run native clusters on DEV',
}, () => {
  assert.equal(process.getuid(), 0)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  for (const path of ['/etc/leaddrive', '/etc/postgresql/16/leaddriverestore', '/var/lib/postgresql/16/leaddriverestore',
    '/var/lib/leaddrive-postgres-scratch-maintenance', '/var/lib/leaddrive-recovery-runner-locks']) assert(!existsSync(path), 'never acquire pre-existing fixture authority: ' + path)
  assert(existsSync('/usr/lib/postgresql/16/bin/postgres'), 'hosted PostgreSQL16 must be installed, not a DEV fallback')
  const root = mkdtempSync('/run/leaddrive-scratch-native-'), runId = String(process.pid) + String(Date.now()).slice(-8)
  const cluster = 'leaddrivefixture' + process.pid
  const pg = '/usr/lib/postgresql/16/bin/'
  const command = (program, args, options = {}) => spawnSync(program, args, {
    env, encoding: 'utf8', timeout: 60000, maxBuffer: 65536, ...options,
  })
  const ok = (result, label = 'public fixture') => assert.equal(result.status, 0, label + ': ' + result.stderr + '\n' + result.stdout)
  const admin = sql => command('runuser', ['-u', 'postgres', '--', pg + 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-h', '/var/run/postgresql', '-p', '55431', '-d', 'postgres'], { input: sql })
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  let ownedSource = false, provisioned = false, ownedUser = false, ownedEtc = false
  try {
    const absent = command('id', ['leaddrive-backup'])
    assert.notEqual(absent.status, 0, 'never reuse a pre-existing backup account')
    ok(command('useradd', ['--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', 'leaddrive-backup']))
    ownedUser = true
    const uid = Number(command('id', ['-u', 'leaddrive-backup']).stdout.trim())
    const gid = Number(command('id', ['-g', 'leaddrive-backup']).stdout.trim())
    const postgresUid = Number(command('id', ['-u', 'postgres']).stdout.trim())
    const postgresGid = Number(command('id', ['-g', 'postgres']).stdout.trim())
    ok(command('pg_createcluster', ['--port', '55431', '--start-conf=manual', '16', cluster]))
    ownedSource = true
    const config = '/etc/postgresql/16/' + cluster
    ok(command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=public-fixture-source',
      '-addext', 'subjectAltName=IP:127.0.0.2', '-keyout', config + '/fixture.key', '-out', config + '/fixture.crt']))
    chmodSync(config + '/fixture.key', 0o600); chownSync(config + '/fixture.key', postgresUid, postgresGid)
    const sourceConf = join(config, 'postgresql.conf')
    writeFileSync(sourceConf, readFileSync(sourceConf, 'utf8') + `\nlisten_addresses='127.0.0.2'\nssl=on\nssl_cert_file='${config}/fixture.crt'\nssl_key_file='${config}/fixture.key'\n`)
    // The destination is .2; Linux selects .1 as the loopback client address.
    writeFileSync(join(config, 'pg_hba.conf'), 'local all postgres peer\nhostssl all fixture_source 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\n')
    ok(command('pg_ctlcluster', ['16', cluster, 'start']))
    ok(admin("CREATE ROLE fixture_source LOGIN PASSWORD 'public-synthetic-only';\nGRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO fixture_source;\nCREATE TABLE fixture_sentinel(value text);\nINSERT INTO fixture_sentinel VALUES ('source must survive');\n"))
    mkdirSync('/etc/leaddrive', { mode: 0o755 }); ownedEtc = true
    writeFileSync('/etc/leaddrive/managed-postgres-ca.crt', readFileSync(config + '/fixture.crt'), { mode: 0o644 })
    writeFileSync('/etc/leaddrive/backup.pgpass', '127.0.0.2:55431:postgres:fixture_source:public-synthetic-only\n', { mode: 0o600 })
    chownSync('/etc/leaddrive/backup.pgpass', uid, gid)
    writeFileSync('/etc/leaddrive/backup.env', 'PGHOST=127.0.0.2\nPGHOSTADDR=127.0.0.2\nPGPORT=55431\nPGDATABASE=postgres\nPGUSER=fixture_source\nPGPASSFILE=/etc/leaddrive/backup.pgpass\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\nPGCONNECT_TIMEOUT=2\n', { mode: 0o640 })
    chownSync('/etc/leaddrive/backup.env', 0, gid)
    const sourceConnection = { ...env, PGHOST: '127.0.0.2', PGHOSTADDR: '127.0.0.2', PGPORT: '55431', PGDATABASE: 'postgres',
      PGUSER: 'fixture_source', PGPASSFILE: '/etc/leaddrive/backup.pgpass', PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/etc/leaddrive/managed-postgres-ca.crt', PGCONNECT_TIMEOUT: '2' }
    ok(command(pg + 'psql', ['-X', '-w', '-At', '-c', 'SELECT (pg_control_system()).system_identifier::text'], { env: sourceConnection }), 'native synthetic source TLS/identity admission')
    const provisioner = new URL('../../.github/scripts/provision_postgres_restore_scratch.py', import.meta.url).pathname
    ok(command('python3', [provisioner, 'apply']), 'reviewed real provisioning')
    provisioned = true
    const protectedPaths = ['/etc/leaddrive/backup.env', '/etc/leaddrive/backup.pgpass', '/etc/leaddrive/restore-verifier.pgpass',
      '/etc/leaddrive/restore-postgres-ca.crt', sourceConf, config + '/pg_hba.conf',
      '/etc/postgresql/16/leaddriverestore/postgresql.conf', '/etc/postgresql/16/leaddriverestore/pg_hba.conf',
      '/etc/postgresql/16/leaddriverestore/server.key', '/etc/postgresql/16/leaddriverestore/server.crt']
    const before = protectedPaths.map(digest)
    const sourceBefore = admin("SELECT (pg_control_system()).system_identifier, pg_postmaster_start_time(), value FROM fixture_sentinel;")
    ok(sourceBefore)
    const program = join(root, 'lifecycle.sh')
    // Only host-memory counters are substituted: the hosted runner may be below
    // production's 8GiB admission. Exact real cgroup/expiry properties are tested.
    writeFileSync(program, `set -Eeuo pipefail\n${definitions}\n${globals}
assert_transient_database_memory_budget() { :; }
trap 'status=$?; stop_commission_scratch || status=99; exit "$status"' EXIT
start_commission_scratch
# A second controller must refuse the real held maintenance lock, without
# replacing/stopping the first server. Same source functions, fresh shell.
bash "$TEST_ROOT/conflict.sh" >/dev/null 2>&1 && exit 98
[ "$(systemctl show --property=InvocationID --value "$SCRATCH_UNIT")" = "$SCRATCH_INVOCATION" ]
systemctl show --property=MemoryMax,MemoryHigh,MemorySwapMax,RuntimeMaxUSec,MainPID "$SCRATCH_UNIT" >"$TEST_ROOT/limits"
pid="$(systemctl show --property=MainPID --value "$SCRATCH_UNIT")"
[[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ]
group="$(awk -F: '$1 == "0" {print $3}' "/proc/$pid/cgroup")"
[ "$(cat "/sys/fs/cgroup$group/memory.max")" = 1073741824 ]
[ "$(cat "/sys/fs/cgroup$group/memory.high")" = 805306368 ]
[ "$(cat "/sys/fs/cgroup$group/memory.swap.max")" = 0 ]
printf '%s\\n' "$SCRATCH_UNIT" >"$TEST_ROOT/unit"
runuser -u postgres -- ${pg}psql -X -v ON_ERROR_STOP=1 -h "/run/leaddrive-restore-scratch-$WORKFLOW_RUN_ID" -p 55432 -d postgres \\
  -c "CREATE DATABASE fixture_restore;" >/dev/null
runuser -u postgres -- ${pg}pg_dump -h /var/run/postgresql -p 55431 -d postgres -Fc >"$TEST_ROOT/public.dump"
chmod 0644 "$TEST_ROOT/public.dump"
runuser -u postgres -- ${pg}pg_restore --exit-on-error --no-owner --no-privileges -h "/run/leaddrive-restore-scratch-$WORKFLOW_RUN_ID" -p 55432 -d fixture_restore "$TEST_ROOT/public.dump"
[ "$(runuser -u postgres -- ${pg}psql -X -At -h "/run/leaddrive-restore-scratch-$WORKFLOW_RUN_ID" -p 55432 -d fixture_restore -c 'SELECT value FROM fixture_sentinel')" = 'source must survive' ]
runuser -u postgres -- ${pg}dropdb -h "/run/leaddrive-restore-scratch-$WORKFLOW_RUN_ID" -p 55432 fixture_restore
case "$TEST_CASE" in failure) exit 23;; success) stop_commission_scratch;; esac
`)
    writeFileSync(join(root, 'conflict.sh'), `set -Eeuo pipefail\n${definitions}\n${globals}
assert_transient_database_memory_budget() { :; }
start_commission_scratch
`)
    chmodSync(root, 0o755)
    for (const mode of ['success', 'failure']) {
      const result = command('bash', [program], { env: { ...env, TEST_RUN_ID: runId + (mode === 'success' ? '1' : '2'), TEST_ROOT: root, TEST_CASE: mode }, timeout: 120000 })
      assert.equal(result.status, mode === 'success' ? 0 : 23, result.stderr + result.stdout)
      const limits = readFileSync(join(root, 'limits'), 'utf8')
      for (const value of ['MemoryHigh=805306368', 'MemoryMax=1073741824', 'MemorySwapMax=0', 'RuntimeMaxUSec=4h 2min']) assert(limits.includes(value), limits)
      assert(!existsSync('/var/lib/postgresql/16/leaddriverestore/postmaster.pid'))
      ok(command(pg + 'pg_controldata', ['/var/lib/postgresql/16/leaddriverestore']))
      assert.match(command(pg + 'pg_controldata', ['/var/lib/postgresql/16/leaddriverestore']).stdout, /Database cluster state:\s+shut down/)
      assert.deepEqual(protectedPaths.map(digest), before, 'canonical/source settings and credentials unchanged')
      assert.equal(admin("SELECT (pg_control_system()).system_identifier, pg_postmaster_start_time(), value FROM fixture_sentinel;").stdout, sourceBefore.stdout, 'source not restarted or logically changed')
    }
    const expiryProgram = join(root, 'expiry.sh')
    writeFileSync(expiryProgram, `set -Eeuo pipefail\n${definitions}\n${globals}
assert_transient_database_memory_budget() { :; }
# Exercise the actual server-side expiry mechanism in seconds, after the
# normal run above proved the exact production 14520-second property.
systemd-run() {
  local arg
  local -a bounded=()
  for arg in "$@"; do
    [ "$arg" != --property=RuntimeMaxSec=14520 ] || arg=--property=RuntimeMaxSec=8
    bounded+=("$arg")
  done
  command systemd-run "${'$'}{bounded[@]}"
}
start_commission_scratch
declare -p SCRATCH_UNIT SCRATCH_DESCRIPTION SCRATCH_INVOCATION SCRATCH_SYSTEM_IDENTIFIER SCRATCH_LOCK_HELD WORKFLOW_RUN_ID >"$TEST_ROOT/owned-state"
# Simulated total controller loss: no exit trap or client cleanup can run.
kill -KILL $$
`)
    const expiry = command('bash', [expiryProgram], { env: { ...env, TEST_RUN_ID: runId + '3', TEST_ROOT: root }, timeout: 30000 })
    assert.equal(expiry.signal, 'SIGKILL', expiry.stderr + expiry.stdout)
    const expired = command('bash', ['-c', `set -Eeuo pipefail\n${definitions}
source "$TEST_ROOT/owned-state"
deadline=$((SECONDS + 25))
while [ -e /var/lib/postgresql/16/leaddriverestore/postmaster.pid ] && [ "$SECONDS" -lt "$deadline" ]; do sleep 1; done
[ ! -e /var/lib/postgresql/16/leaddriverestore/postmaster.pid ]
# Reacquire the same fixed maintenance lock only after the original process
# died; cleanup still checks the unique description and invocation identity.
exec 4</var/lib/leaddrive-recovery-runner-locks/postgres-restore-scratch-maintenance.lock
flock -n 4
stop_commission_scratch
`], { env: { ...env, TEST_ROOT: root }, timeout: 35000 })
    ok(expired, 'actual server expiry after controller loss')
    assert.deepEqual(protectedPaths.map(digest), before)
    assert.equal(admin("SELECT (pg_control_system()).system_identifier, pg_postmaster_start_time(), value FROM fixture_sentinel;").stdout, sourceBefore.stdout)
    assert.equal(readdirSync('/run').filter(name => name.startsWith('leaddrive-restore-scratch-')).length, 0)
  } catch (error) {
    // Never let a separate fixture-cleanup failure hide the original actual
    // policy/kernel/SQL failure. Only fresh public synthetic data exists here.
    process.stderr.write('SYNTHETIC_PRIMARY_FAILURE: ' + error.stack + '\n')
    const unit = 'leaddrive-restore-scratch-' + runId + '1.service'
    process.stderr.write(command('journalctl', ['--unit=' + unit, '--no-pager', '--output=cat', '--lines=20']).stdout)
    throw error
  } finally {
    // Fresh hosted synthetic authorities only, proved absent at entry. Never
    // remove a real cluster/configuration or acquire any pre-existing service.
    if (provisioned) {
      // This is fixture teardown, NOT proof of the independent production
      // provisioner's rollback ceremony. pg_dropcluster does not own custom
      // TLS filenames; remove only these fresh synthetic files before dropping
      // this fixture's already-tested cluster. All were absent at entry.
      if (existsSync('/var/lib/postgresql/16/leaddriverestore/postmaster.pid')) {
        ok(command('pg_ctlcluster', ['--skip-systemctl-redirect', '16', 'leaddriverestore', 'stop']))
      }
      for (const name of ['server.crt', 'server.key']) unlinkSync('/etc/postgresql/16/leaddriverestore/' + name)
      ok(command('pg_dropcluster', ['--stop', '16', 'leaddriverestore']), 'drop fresh synthetic scratch')
    }
    if (ownedSource) {
      ok(command('pg_ctlcluster', ['16', cluster, 'stop']))
      for (const name of ['fixture.crt', 'fixture.key']) unlinkSync('/etc/postgresql/16/' + cluster + '/' + name)
      ok(command('pg_dropcluster', ['--stop', '16', cluster]))
    }
    if (ownedEtc) rmSync('/etc/leaddrive', { recursive: true })
    if (ownedUser) ok(command('userdel', ['leaddrive-backup']))
    rmSync(root, { recursive: true, force: true })
  }
})
