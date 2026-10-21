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
  'scratch_connection_query', 'admit_commission_scratch', 'start_commission_scratch', 'assert_owned_scratch_running',
  'scratch_admin_sql', 'prepare_commission_scratch_template', 'drop_commission_scratch_template', 'stop_commission_scratch']
const definitions = functions.map(extract).join('\n')
const globals = `WORKFLOW_RUN_ID="$TEST_RUN_ID"
OPERATION=run-verified-backup
BACKUP_ENV_FILE=/etc/leaddrive/backup.env
SCRATCH_UNIT="" SCRATCH_DESCRIPTION="" SCRATCH_INVOCATION="" SCRATCH_SYSTEM_IDENTIFIER="" SCRATCH_LOCK_HELD=0
SCRATCH_TEMPLATE="" SCRATCH_TEMPLATE_NONCE="" SCRATCH_SOURCE_IDENTIFIER=""
CODE_STAGE=${JSON.stringify(new URL('../..', import.meta.url).pathname.replace(/\/$/, ''))}
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

test('the actual generated native drill shell parses before starting any hosted service', () => {
  const fixture = readFileSync(new URL('./scratch-service.test.mjs', import.meta.url), 'utf8')
  const literal = fixture.match(/nativeDrill = (`[\s\S]*?`)\n    }/)[1]
  // Evaluate only this file's fixed public template literal with its two local
  // code/path helpers, not any archive, environment or user-provided input.
  const drill = new Function('code', 'join', `return ${literal}`)('/public-fixture-code', join)
  const parsed = spawnSync('bash', ['-n'], { input: drill, encoding: 'utf8' })
  assert.equal(parsed.status, 0, parsed.stderr)
})

test('genuine hosted two-cluster TLS lifecycle, source preservation and failure cleanup', {
  skip: process.env.LEADDRIVE_TEST_REAL_SCRATCH === '1' ? false : 'requires isolated hosted Ubuntu24 PG16/systemd; never run native clusters on DEV',
}, () => {
  assert.equal(process.getuid(), 0)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  for (const path of ['/etc/leaddrive', '/etc/postgresql/16/leaddriverestore', '/var/lib/postgresql/16/leaddriverestore',
    '/var/lib/leaddrive-postgres-scratch-maintenance', '/var/lib/leaddrive-recovery-runner-locks', '/opt/leaddrive-v2']) assert(!existsSync(path), 'never acquire pre-existing fixture authority: ' + path)
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
  let ownedSource = false, provisioned = false, ownedUser = false, ownedEtc = false, ownedMarker = false
  try {
    const absent = command('id', ['leaddrive-backup'])
    assert.notEqual(absent.status, 0, 'never reuse a pre-existing backup account')
    ok(command('useradd', ['--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', 'leaddrive-backup']))
    ownedUser = true
    const uid = Number(command('id', ['-u', 'leaddrive-backup']).stdout.trim())
    const gid = Number(command('id', ['-g', 'leaddrive-backup']).stdout.trim())
    const postgresUid = Number(command('id', ['-u', 'postgres']).stdout.trim())
    const postgresGid = Number(command('id', ['-g', 'postgres']).stdout.trim())
    ok(command('pg_createcluster', ['--port', '55431', '--start-conf=manual', '--encoding', 'UTF8', '--locale', 'C.UTF-8', '16', cluster]))
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
    ok(admin('CREATE EXTENSION pgcrypto;\nCREATE EXTENSION btree_gist;\n'))
    const nativeTemplate = process.env.LEADDRIVE_TEST_NATIVE_TEMPLATE === '1'
    if (nativeTemplate) {
      ok(admin(`CREATE EXTENSION vector VERSION '0.6.0';
COMMENT ON EXTENSION vector IS 'public native vector fixture';
CREATE TABLE organizations(id text PRIMARY KEY);
CREATE TABLE users(id text PRIMARY KEY, "organizationId" text);
CREATE TABLE contacts(id text PRIMARY KEY, "organizationId" text, embedding vector(3));
CREATE INDEX fixture_hnsw ON contacts USING hnsw(embedding vector_l2_ops);
CREATE TABLE deals(id text PRIMARY KEY, "organizationId" text);
INSERT INTO organizations VALUES ('alpha'),('beta');
INSERT INTO users VALUES ('user-alpha','alpha'),('user-beta','beta');
INSERT INTO contacts VALUES ('Əlaqə Ж','alpha','[1,2,3]'),('contact-beta','beta','[4,5,6]');
INSERT INTO deals VALUES ('deal-alpha','alpha'),('deal-beta','beta');
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_contacts ON contacts USING (current_setting('app.rls_bypass',true)='on' OR "organizationId"=current_setting('app.org_id',true));
CREATE TABLE _prisma_migrations(id text, checksum text, finished_at timestamptz, migration_name text,
 logs text, rolled_back_at timestamptz, started_at timestamptz, applied_steps_count int);
INSERT INTO _prisma_migrations VALUES ('fixture','${'a'.repeat(64)}','2026-10-20T00:00:00Z','20261020_fixture',NULL,NULL,'2026-10-20T00:00:00Z',1);
CREATE FUNCTION fixture_function() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 42; END $$;
`), 'native full schema fixture')
    }
    mkdirSync('/etc/leaddrive', { mode: 0o755 }); ownedEtc = true
    writeFileSync('/etc/leaddrive/managed-postgres-ca.crt', readFileSync(config + '/fixture.crt'), { mode: 0o644 })
    writeFileSync('/etc/leaddrive/backup.pgpass', '127.0.0.2:55431:postgres:fixture_source:public-synthetic-only\n', { mode: 0o600 })
    chownSync('/etc/leaddrive/backup.pgpass', uid, gid)
    writeFileSync('/etc/leaddrive/backup.env', 'PGHOST=127.0.0.2\nPGHOSTADDR=127.0.0.2\nPGPORT=55431\nPGDATABASE=postgres\nPGUSER=fixture_source\nPGPASSFILE=/etc/leaddrive/backup.pgpass\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\nPGCONNECT_TIMEOUT=2\nBACKUP_EXPECTED_DB_ROLE=fixture_source\n', { mode: 0o640 })
    chownSync('/etc/leaddrive/backup.env', 0, gid)
    const sourceConnection = { ...env, PGHOST: '127.0.0.2', PGHOSTADDR: '127.0.0.2', PGPORT: '55431', PGDATABASE: 'postgres',
      PGUSER: 'fixture_source', PGPASSFILE: '/etc/leaddrive/backup.pgpass', PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/etc/leaddrive/managed-postgres-ca.crt', PGCONNECT_TIMEOUT: '2' }
    ok(command(pg + 'psql', ['-X', '-w', '-At', '-c', 'SELECT (pg_control_system()).system_identifier::text'], { env: sourceConnection }), 'native synthetic source TLS/identity admission')
    mkdirSync('/opt/leaddrive-v2/.next/standalone', { recursive: true, mode: 0o755 })
    ownedMarker = true
    writeFileSync('/opt/leaddrive-v2/.next/standalone/.deploy-sha', 'a'.repeat(40) + '\n', { mode: 0o644 })
    const metadataHelper = new URL('../../.github/scripts/inspect-backup-compatibility.mjs', import.meta.url).pathname
    const metadata = command(process.execPath, [metadataHelper, '--inspect', 'a'.repeat(40)])
    ok(metadata, 'real limited-login source catalog compatibility metadata')
    const report = JSON.parse(metadata.stdout)
    assert.equal(report.source.major, 16)
    assert.equal(report.source.encoding, 'UTF8')
    assert.equal(report.source.unknownExtensionCount, 0)
    assert.equal(report.scratchDatabaseCompatibility, 'not-inspected')
    for (const name of ['plpgsql', 'pgcrypto', 'btree_gist']) {
      assert(report.source.extensions.some(entry => entry.name === name))
      assert.equal(report.source.extensions.find(entry => entry.name === name).sourceVersionAvailable, true)
    }
    for (const privateValue of ['fixture_source', 'fixture_sentinel', '127.0.0.2', 'public-synthetic-only', 'source must survive']) assert(!metadata.stdout.includes(privateValue))
    ok(command(process.execPath, [metadataHelper, '--validate-output'], { input: metadata.stdout }), 'second independent output schema')
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
    const repo = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
    if (nativeTemplate) {
      // Exercise the actual no-dump preflight orchestration, native SQL,
      // existing locks, TLS admission, preserved bytes and ten-minute kernel
      // lifetime. Only the fixture's deliberately incomplete backup.env and
      // public-code bundle setup are substituted; not the database lifecycle.
      for (const [name, group, mode] of [['postgres-backup.lock', gid, 0o660], ['secrets-snapshot.lock', 0, 0o600],
        ['runtime-files-snapshot.lock', 0, 0o600], ['log-ship.lock', gid, 0o660]]) {
        const path = '/var/lib/leaddrive-recovery-runner-locks/' + name
        assert(!existsSync(path))
        writeFileSync(path, '', { mode }); chmodSync(path, mode); chownSync(path, 0, group)
      }
      const preflight = join(root, 'preflight.sh')
      const extra = ['assert_confirmation', 'assert_owner_source_boundary', 'lock_native_preflight_runners',
        'native_preflight_preservation_digest', 'release_backup_locks', 'probe_native_scratch_template'].map(extract).join('\n')
      writeFileSync(preflight, `set -Eeuo pipefail\n${definitions}\n${extra}\n${globals}
OPERATION=probe-native-scratch WORKFLOW_SHA=${'a'.repeat(40)}
CONFIRMATION=CHECK_NATIVE_SCRATCH_TEMPLATE_ON_13_140_132_245
EXPECTED_RECIPIENT_SHA256='' KEY_CUSTODY_ATTESTATION='' EVIDENCE_REF='' EVIDENCE_AT_UTC=''
OFFLINE_OPERATOR='' EXPECTED_CANDIDATE_SHA256='' OWNER_RECIPIENT=''
INCOMING_EVIDENCE_BUNDLE="$TEST_ROOT/absent-evidence" INCOMING_ALLOWED_SIGNERS="$TEST_ROOT/absent-signers"
INCOMING_MONITORING_CONFIG="$TEST_ROOT/absent-monitoring" INCOMING_B2_WRITER_CONFIG="$TEST_ROOT/absent-writer"
BACKUP_SERVICE=fixture-backup.service SECRETS_SERVICE=fixture-secrets.service RUNTIME_FILES_SERVICE=fixture-runtime.service LOG_SERVICE=fixture-log.service
BACKUP_TIMER=fixture-backup.timer SECRETS_TIMER=fixture-secrets.timer RUNTIME_FILES_TIMER=fixture-runtime.timer LOG_TIMER=fixture-log.timer
BACKUP_RUNTIME_LOCK=/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock
SECRETS_RUNTIME_LOCK=/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock
RUNTIME_FILES_RUNTIME_LOCK=/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock
LOG_RUNTIME_LOCK=/var/lib/leaddrive-recovery-runner-locks/log-ship.lock
BACKUP_LOCK_HELD=0 SECRETS_LOCK_HELD=0 RUNTIME_FILES_LOCK_HELD=0 LOG_LOCK_HELD=0
assert_backup_env() { :; }
prepare_commission_code() { :; }
assert_transient_database_memory_budget() { :; }
systemd-run() { printf '%s\\n' "$@" >"$TEST_ROOT/preflight-argv"; command systemd-run "$@"; }
trap 'status=$?; stop_commission_scratch || status=99; exit "$status"' EXIT
if [ "$TEST_CASE" = preservation-refusal ]; then
  eval "$(declare -f prepare_commission_scratch_template | sed '1s/prepare_commission_scratch_template/real_prepare/')"
  prepare_commission_scratch_template() {
    real_prepare
    printf '%s\\n' ${'b'.repeat(40)} >/opt/leaddrive-v2/.next/standalone/.deploy-sha
  }
fi
probe_native_scratch_template
`)
      for (const mode of ['normal', 'preservation-refusal']) {
        const proof = command('bash', [preflight], { env: { ...env, TEST_RUN_ID: runId + (mode === 'normal' ? '5' : '6'), TEST_ROOT: root, TEST_CASE: mode }, timeout: 120000 })
        assert.equal(proof.status, mode === 'normal' ? 0 : 1, proof.stdout + proof.stderr)
        assert(readFileSync(join(root, 'preflight-argv'), 'utf8').includes('--property=RuntimeMaxSec=600'))
        if (mode === 'normal') assert(proof.stdout.includes('NATIVE_SCRATCH_PREFLIGHT=passed'))
        else {
          assert(proof.stderr.includes('preservation proof changed'))
          assert(!proof.stdout.includes('NATIVE_SCRATCH_PREFLIGHT=passed'))
          writeFileSync('/opt/leaddrive-v2/.next/standalone/.deploy-sha', 'a'.repeat(40) + '\n')
        }
        assert(!existsSync('/var/lib/postgresql/16/leaddriverestore/postmaster.pid'))
        assert.deepEqual(protectedPaths.map(digest), before)
        assert.equal(admin("SELECT (pg_control_system()).system_identifier, pg_postmaster_start_time(), value FROM fixture_sentinel;").stdout, sourceBefore.stdout)
      }
    }
    let nativeDrill = ''
    if (nativeTemplate) {
      const inputs = join(root, 'inputs'), work = join(root, 'canary-work')
      const code = join(root, 'reviewed')
      mkdirSync(inputs, { mode: 0o700 }); mkdirSync(work, { mode: 0o700 })
      mkdirSync(code, { mode: 0o755 })
      // The runner checkout's parents are not public to system accounts. Stage
      // only exact public reviewed bytes, never chmod the checkout/private data.
      for (const name of ['postgres-restore-canary.sh', 'native-scratch-template.mjs', 'canary.sql', 'migration-ledger.sql']) {
        writeFileSync(join(code, name), readFileSync(join(repo, 'scripts/backup', name)), { mode: 0o644 })
      }
      const backup = readFileSync(join(repo, 'scripts/backup/postgres-backup.sh'), 'utf8')
      const sourceCheck = backup.match(/^assert_native_source_contract\(\) \{[\s\S]*?^\}/m)[0]
      writeFileSync(join(code, 'source-check.sh'), `set -Eeuo pipefail\nSCRATCH_TEMPLATE_ARG=admitted\nSCRIPT_DIR=${JSON.stringify(code)}\nfatal() { exit 70; }\n${sourceCheck}\nassert_native_source_contract\n`, { mode: 0o644 })
      const canaryScript = readFileSync(join(repo, 'scripts/backup/postgres-restore-canary.sh'), 'utf8')
      const securityStart = canaryScript.indexOf('WITH raw(kind, k1, k2, k3, k4, k5, k6, k7, k8) AS (')
      assert(securityStart > 0)
      const securitySql = canaryScript.slice(securityStart, canaryScript.indexOf('\nSQL', securityStart))
      const exportQuery = (file, options) => {
        const input = options[0] === '-f' ? readFileSync(options[1]) : undefined
        if (input) options = ['-f', '-']
        const result = command('runuser', ['-u', 'postgres', '--', pg + 'psql', '-X', '-qAt', '-F', '\t', '-v', 'ON_ERROR_STOP=1',
          '-h', '/var/run/postgresql', '-p', '55431', '-d', 'postgres', ...options], { input })
        ok(result, 'real public source export')
        writeFileSync(join(inputs, file), result.stdout, { mode: 0o600 })
      }
      exportQuery('canary.tsv', ['-f', join(repo, 'scripts/backup/canary.sql')])
      exportQuery('ledger.tsv', ['-f', join(repo, 'scripts/backup/migration-ledger.sql')])
      exportQuery('authority.tsv', ['-c', securitySql])
      writeFileSync(join(inputs, 'contract.tsv'), `SCHEMA\tprisma/schema.prisma\t${'b'.repeat(64)}\nMIGRATION_LOCK\tprisma/migrations/migration_lock.toml\t${'c'.repeat(64)}\nMIGRATION\t20261020_fixture\t${'a'.repeat(64)}\n`, { mode: 0o600 })
      writeFileSync(join(inputs, 'bad-canary.tsv'), 'deliberate synthetic mismatch\n', { mode: 0o600 })
      const dump = command(pg + 'pg_dump', ['-h', '/var/run/postgresql', '-p', '55431', '-U', 'postgres', '-d', 'postgres', '-Fc'], { encoding: null, maxBuffer: 4 * 1024 * 1024 })
      // Root is peer-rejected on the source: use its genuine OS postgres login,
      // not a source-authentication relaxation or a table-only dump.
      const fullDump = command('runuser', ['-u', 'postgres', '--', pg + 'pg_dump', '-h', '/var/run/postgresql', '-p', '55431', '-d', 'postgres', '-Fc'], { encoding: null, maxBuffer: 4 * 1024 * 1024 })
      assert.notEqual(dump.status, 0, 'source peer authentication remains enforced')
      assert.equal(fullDump.status, 0, String(fullDump.stderr))
      writeFileSync(join(inputs, 'database.dump'), fullDump.stdout, { mode: 0o600 })
      for (const name of readdirSync(inputs)) chownSync(join(inputs, name), uid, gid)
      chownSync(inputs, uid, gid); chownSync(work, uid, gid)
      nativeDrill = `
helper="$CODE_STAGE/scripts/backup/native-scratch-template.mjs"
# Real install-error injection is synthetic only. Verify the whole temporary
# privilege/extension transaction rolls back, then run unmodified preparation.
SCRATCH_SOURCE_IDENTIFIER="$(scratch_connection_query source 'SELECT (pg_control_system()).system_identifier::text')"
SCRATCH_TEMPLATE_NONCE=0123456789abcdef0123456789abcdef
SCRATCH_TEMPLATE="leaddrive_restore_template_${'$'}{WORKFLOW_RUN_ID}_${'$'}{SCRATCH_TEMPLATE_NONCE:0:12}"
node "$helper" --plan create "$SCRATCH_SYSTEM_IDENTIFIER" "$SCRATCH_SOURCE_IDENTIFIER" "$WORKFLOW_RUN_ID" "$SCRATCH_TEMPLATE_NONCE" | scratch_admin_sql postgres >/dev/null
if node "$helper" --plan bootstrap "$SCRATCH_SYSTEM_IDENTIFIER" "$SCRATCH_SOURCE_IDENTIFIER" "$WORKFLOW_RUN_ID" "$SCRATCH_TEMPLATE_NONCE" \\
 | sed 's/^CREATE EXTENSION vector.*$/SELECT 1\\/0;/' | scratch_admin_sql "$SCRATCH_TEMPLATE" >/dev/null; then exit 94; fi
[ "$(scratch_connection_query scratch "SELECT rolsuper::int FROM pg_roles WHERE rolname=session_user")" = 0 ]
[ "$(printf '%s' 'SELECT count(*) FROM pg_catalog.pg_extension' | scratch_admin_sql "$SCRATCH_TEMPLATE")" = 1 ]
drop_commission_scratch_template
prepare_commission_scratch_template
runuser -u leaddrive-backup -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \\
 PGHOST=127.0.0.2 PGHOSTADDR=127.0.0.2 PGPORT=55431 PGDATABASE=postgres PGUSER=fixture_source \\
 PGPASSFILE=/etc/leaddrive/backup.pgpass PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt PGSSLMODE=verify-full \\
 bash ${JSON.stringify(join(code, 'source-check.sh'))}
# Same exact database name but different complete marker: never drop it.
wrong_nonce="${'$'}{SCRATCH_TEMPLATE_NONCE:0:31}a"
[ "$wrong_nonce" != "$SCRATCH_TEMPLATE_NONCE" ] || wrong_nonce="${'$'}{SCRATCH_TEMPLATE_NONCE:0:31}b"
if node "$helper" --plan drop "$SCRATCH_SYSTEM_IDENTIFIER" "$SCRATCH_SOURCE_IDENTIFIER" "$WORKFLOW_RUN_ID" "$wrong_nonce" | scratch_admin_sql postgres >/dev/null; then exit 95; fi
[ "$(scratch_connection_query scratch "SELECT count(*) FROM pg_database WHERE datname='$SCRATCH_TEMPLATE'")" = 1 ]
native_args=("$TEST_ROOT/inputs/database.dump" "$TEST_ROOT/inputs/canary.tsv" "$SCRATCH_SOURCE_IDENTIFIER" "$TEST_ROOT/inputs/authority.tsv" "$TEST_ROOT/inputs/ledger.tsv" "$TEST_ROOT/inputs/contract.tsv")
if [ "$TEST_CASE" = canary-failure ]; then native_args[1]="$TEST_ROOT/inputs/bad-canary.tsv"; fi
set +e
runuser -u leaddrive-backup -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \\
 TMPDIR="$TEST_ROOT/canary-work" PGHOST=127.0.0.2 PGPORT=55431 PGHOSTADDR=203.0.113.99 \\
 VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT=55432 VERIFY_PGUSER=leaddrive_restore_verifier \\
 VERIFY_PGMAINTENANCE_DB=postgres VERIFY_PGPASSFILE=/etc/leaddrive/restore-verifier.pgpass \\
 VERIFY_PGSSLROOTCERT=/etc/leaddrive/restore-postgres-ca.crt VERIFY_PGSSLMODE=verify-full \\
 VERIFY_PGTEMPLATE="$SCRATCH_TEMPLATE" bash ${JSON.stringify(join(code, 'postgres-restore-canary.sh'))} "\${native_args[@]}"
canary_status=$?
set -e
if [ "$TEST_CASE" = canary-failure ]; then [ "$canary_status" -ne 0 ]; else [ "$canary_status" = 0 ]; fi
orphan_count="$(scratch_connection_query scratch "SELECT count(*) FROM pg_database WHERE datname ~ '^leaddrive_restore_verify_'")"
[ "$orphan_count" = 0 ]
[ -z "$(find "$TEST_ROOT/canary-work" -mindepth 1 -print -quit)" ]
`
    }
    const program = join(root, 'lifecycle.sh')
    // Only host-memory counters are substituted: the hosted runner may be below
    // production's 8GiB admission. Exact real cgroup/expiry properties are tested.
    writeFileSync(program, `set -Eeuo pipefail\n${definitions}\n${globals}
assert_transient_database_memory_budget() { :; }
trap 'status=$?; stop_commission_scratch || status=99; exit "$status"' EXIT
start_commission_scratch
${nativeDrill}
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
case "$TEST_CASE" in failure) exit 23;; success|canary-failure) stop_commission_scratch;; esac
`)
    writeFileSync(join(root, 'conflict.sh'), `set -Eeuo pipefail\n${definitions}\n${globals}
assert_transient_database_memory_budget() { :; }
start_commission_scratch
`)
    chmodSync(root, 0o755)
    for (const mode of nativeTemplate ? ['success', 'canary-failure', 'failure'] : ['success', 'failure']) {
      const result = command('bash', [program], { env: { ...env, TEST_RUN_ID: runId + (mode === 'success' ? '1' : mode === 'canary-failure' ? '4' : '2'), TEST_ROOT: root, TEST_CASE: mode }, timeout: 120000 })
      assert.equal(result.status, mode === 'failure' ? 23 : 0, result.stderr + result.stdout)
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
${nativeTemplate ? 'prepare_commission_scratch_template' : ''}
declare -p SCRATCH_UNIT SCRATCH_DESCRIPTION SCRATCH_INVOCATION SCRATCH_SYSTEM_IDENTIFIER SCRATCH_LOCK_HELD WORKFLOW_RUN_ID SCRATCH_TEMPLATE SCRATCH_TEMPLATE_NONCE SCRATCH_SOURCE_IDENTIFIER CODE_STAGE >"$TEST_ROOT/owned-state"
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
${nativeTemplate ? 'if stop_commission_scratch; then exit 96; fi\n[ -n "$SCRATCH_TEMPLATE" ]\n[ ! -e /var/lib/postgresql/16/leaddriverestore/postmaster.pid ]' : 'stop_commission_scratch'}
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
    if (ownedMarker) rmSync('/opt/leaddrive-v2', { recursive: true })
    if (ownedUser) ok(command('userdel', ['leaddrive-backup']))
    rmSync(root, { recursive: true, force: true })
  }
})
