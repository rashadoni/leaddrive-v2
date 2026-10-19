import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const source = readFileSync(new URL('./commission-production-backup.sh', import.meta.url), 'utf8')
function extract(name) {
  const matches = [...source.matchAll(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'gm'))]
  assert.equal(matches.length, 1)
  return matches[0][0]
}
const values = {
  BACKUP_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
  BACKUP_S3_REGION: 'eu-central-003', BACKUP_S3_BUCKET: 'leaddrive-prod-backups',
  AWS_ACCESS_KEY_ID: 'SYNTHETIC_WRITER_ID_123', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_WRITER_SECRET_123',
}
const writer = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
const inherited = 'BACKUP_ENCRYPTION=off\nBACKUP_AGE_RECIPIENT=old-public-recipient\nPGHOST=preserved-db\n# keep exactly\nUNRELATED="preserve spaces"\n'
const predecessor = inherited + 'BACKUP_S3_ENDPOINT=https://retired.invalid\nBACKUP_S3_REGION=retired\nBACKUP_S3_BUCKET=old-archives\nAWS_ACCESS_KEY_ID=OLD_ID\nAWS_SECRET_ACCESS_KEY=OLD_SECRET\n'
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-b2-writer-test-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const readers = ['trim_value', 'read_static_env_value', 'read_unique_value_from', 'read_unique_value', 'object_storage_endpoint_matches_region'].map(extract).join('\n')

test('strict writer schema accepts generated literals without shell evaluation', () => fixture(dir => {
  const file = join(dir, 'writer.env')
  writeFileSync(file, writer, { mode: 0o600 })
  const execute = () => spawnSync('bash', ['-c', `set -euo pipefail\nfatal() { echo "rejected" >&2; exit 1; }\n${readers}\n${extract('validate_b2_writer_config')}\nvalidate_b2_writer_config "$1"`, 'test', file], { env: environment, encoding: 'utf8', timeout: 5000 })
  assert.equal(execute().status, 0)
  writeFileSync(file, writer.trimEnd())
  assert.equal(execute().status, 0, 'a GitHub secret need not retain a final newline')
  const bad = [
    writer + 'AWS_SECRET_ACCESS_KEY=second\n', writer + '\n', writer + 'PGHOST=not-allowed\n',
    writer.replace('eu-central-003.backblazeb2.com', 'us-west-004.backblazeb2.com'),
    writer.replace('https://', 'http://'), writer.replace('backblazeb2.com', 'backblazeb2.com.attacker.invalid'),
    writer.replace('leaddrive-prod-backups', 'other-bucket'),
    writer.replace('AWS_ACCESS_KEY_ID=', 'export AWS_ACCESS_KEY_ID='),
    writer.replace('SYNTHETIC_WRITER_ID_123', 'short'),
    writer.replace('SYNTHETIC_WRITER_SECRET_123', `$(touch ${join(dir, 'must-not-exist')})`),
    writer.replace('SYNTHETIC_WRITER_SECRET_123', '"SYNTHETIC_WRITER_SECRET_123"'),
    writer.replaceAll('\n', '\r\n'), writer + '#comment\n', 'x'.repeat(8193),
    writer.replace('AWS_ACCESS_KEY_ID=SYNTHETIC_WRITER_ID_123\n', ''),
    writer + 'AGE-SECRET-KEY-1SYNTHETIC\n',
  ]
  for (const input of bad) {
    writeFileSync(file, input)
    const result = execute()
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'rejected\n', 'never echo rejected data')
  }
  assert.equal(existsSync(join(dir, 'must-not-exist')), false)
}))

function configure(dir, { input = writer, old = predecessor, lock = 'Enabled\tCOMPLIANCE\t14', awsStatus = 0,
  encryption = 'off', enabled = 'disabled', active = 'inactive', service = 'inactive', live = 'a'.repeat(40),
  inputMode = 0o600, symlink = false, evidence = false, syncFailure = false, conflict = false, extraEvidence = false } = {}) {
  const config = join(dir, 'backup.env'), incoming = join(dir, 'writer.env'), marker = join(dir, 'live-sha')
  writeFileSync(config, old.replace('BACKUP_ENCRYPTION=off', `BACKUP_ENCRYPTION=${encryption}`), { mode: 0o600 })
  writeFileSync(incoming, input, { mode: inputMode })
  chmodSync(incoming, inputMode)
  writeFileSync(marker, live + '\n', { mode: 0o600 })
  if (evidence) writeFileSync(join(dir, 'genesis'), 'old-evidence', { mode: 0o600 })
  if (symlink) { symlinkSync(incoming, join(dir, 'input-link')); }
  // Run the ACTUAL operation against an explicit test-directory path rewrite.
  // Only root identity, systemd state, installed-tool admission and provider
  // response are synthetic; file transforms/atomic rename/durability/rollback
  // execute for real, as a non-root user, with no production/network access.
  const operation = extract('configure_b2_writer').replaceAll('/etc/leaddrive', dir).replaceAll('/opt/leaddrive-v2/.deploy-sha', marker)
  const restore = extract('restore_b2_writer_predecessor').replaceAll('/etc/leaddrive', dir)
  const result = spawnSync('bash', ['-c', `set -Eeuo pipefail
umask 077
fatal() { echo "rejected" >&2; exit 1; }
log() { printf '%s\\n' "$1"; }
${readers}
${extract('validate_b2_writer_config')}
${extract('assert_confirmation')}
${extract('assert_owner_source_boundary')}
assert_root_directory() { [ -d "$2" ] && [ ! -L "$2" ] || fatal; }
assert_root_file() { [ -f "$2" ] && [ ! -L "$2" ] || fatal; }
stat() { case "$*" in '-c %U:%G '*) echo root:root;; '-c %U:%G:%a '*) printf 'root:root:%s\\n' "$(command stat -c '%a' "$3")";; *) command stat "$@";; esac; }
systemctl() { case "$*" in *LoadState*) echo loaded;; is-enabled*) echo "$ENABLED";; is-active*timer) echo "$ACTIVE";; is-active*) echo "$SERVICE";; *) exit 1;; esac; }
assert_toolchain() { :; }
run_aws() { printf '%s\\n' "$*" >"$ROOT/aws-args"; printf '%s' "$LOCK"; [ "$AWS_STATUS" = 0 ]; }
sync() {
  if [ "$SYNC_FAILURE" = yes ] && [ "$B2_ENV_REPLACED" = 1 ]; then SYNC_FAILURE=no; return 1; fi
  if [ "$CONFLICT" = yes ] && [ -n "$ENV_STAGE" ]; then printf '# concurrent edit\\n' >>"$BACKUP_ENV_FILE"; fi
  command sync "$@"
}
${operation}
${restore}
CONFIRMATION=CONFIGURE_B2_WRITER_ON_13_140_132_245
WORKFLOW_SHA=${'a'.repeat(40)} WORKFLOW_RUN_ID=17
EXPECTED_RECIPIENT_SHA256="$EXTRA_EVIDENCE" KEY_CUSTODY_ATTESTATION='' EVIDENCE_REF='' EVIDENCE_AT_UTC='' OFFLINE_OPERATOR='' EXPECTED_CANDIDATE_SHA256='' OWNER_RECIPIENT=''
BACKUP_ENV_FILE="$ROOT/backup.env" INCOMING_B2_WRITER_CONFIG="$INPUT"
BACKUP_TIMER=db.timer SECRETS_TIMER=secrets.timer RUNTIME_FILES_TIMER=runtime.timer LOG_TIMER=logs.timer
BACKUP_SERVICE=db.service SECRETS_SERVICE=secrets.service RUNTIME_FILES_SERVICE=runtime.service LOG_SERVICE=logs.service
LOG_GENESIS_ANCHOR="$ROOT/genesis" CURRENT_RESTORE_MARKER="$ROOT/certificate" BOOTSTRAP_RESTORE_MARKER="$ROOT/bootstrap"
ENV_STAGE='' B2_ROLLBACK_DIR='' B2_ENV_REPLACED=0 B2_CONFIG_COMMITTED=0
trap 'status=$?; trap - EXIT; if [ "$B2_ENV_REPLACED" = 1 ] && [ "$B2_CONFIG_COMMITTED" = 0 ]; then restore_b2_writer_predecessor || status=99; fi; exit "$status"' EXIT
configure_b2_writer
`, 'test'], { encoding: 'utf8', timeout: 10000, env: { ...environment, ROOT: dir,
    INPUT: symlink ? join(dir, 'input-link') : incoming,
    LOCK: lock, AWS_STATUS: String(awsStatus), ENABLED: enabled, ACTIVE: active, SERVICE: service,
    SYNC_FAILURE: syncFailure ? 'yes' : 'no', CONFLICT: conflict ? 'yes' : 'no', EXTRA_EVIDENCE: extraEvidence ? 'forbidden' : '',
  } })
  assert.ifError(result.error)
  for (const privateValue of [values.AWS_ACCESS_KEY_ID, values.AWS_SECRET_ACCESS_KEY, 'OLD_SECRET']) {
    assert.equal((result.stdout + result.stderr).includes(privateValue), false, 'no credential output')
  }
  return { result, config: readFileSync(config, 'utf8'), rollbacks: readdirSync(dir).filter(name => name.startsWith('backup-storage-rollback.')),
    awsArgs: existsSync(join(dir, 'aws-args')) ? readFileSync(join(dir, 'aws-args'), 'utf8') : '' }
}

test('actual operation changes only five settings and preserves a protected predecessor', () => fixture(dir => {
  const observed = configure(dir)
  assert.equal(observed.result.status, 0, observed.result.stderr)
  assert.equal(observed.config, inherited + writer)
  assert.equal(observed.rollbacks.length, 1)
  assert.equal(readFileSync(join(dir, observed.rollbacks[0], 'backup.env'), 'utf8'), predecessor)
  assert.match(observed.result.stdout, /backup\/restore NOT RUN/)
  assert.match(observed.awsArgs, /^45 SYNTHETIC_WRITER_ID_123 SYNTHETIC_WRITER_SECRET_123 s3api get-object-lock-configuration /)
  assert.match(observed.awsArgs, /--endpoint-url https:\/\/s3.eu-central-003.backblazeb2.com --region eu-central-003/)
  assert.doesNotMatch(observed.awsArgs, /put-object|upload|delete-object/)
}))

test('actual operation fails closed before any write for unsafe source, input or provider state', () => {
  for (const options of [
    { lock: 'Enabled\tGOVERNANCE\t14' }, { lock: 'Enabled\tCOMPLIANCE\t13' },
    { lock: 'Enabled\tCOMPLIANCE\t14\nEnabled\tCOMPLIANCE\t14' }, { lock: '' }, { awsStatus: 1 },
    { encryption: 'age' }, { enabled: 'enabled' }, { active: 'active' }, { service: 'activating' },
    { live: 'b'.repeat(40) }, { inputMode: 0o644 }, { symlink: true }, { evidence: true },
    { input: writer + 'PGHOST=forbidden\n' }, { old: predecessor + 'AWS_ACCESS_KEY_ID=duplicate\n' },
    { old: predecessor.trimEnd() }, { extraEvidence: true },
  ]) fixture(dir => {
    const observed = configure(dir, options)
    assert.equal(observed.result.status, 1, JSON.stringify(options))
    assert.equal(observed.config, (options.old ?? predecessor).replace('BACKUP_ENCRYPTION=off', `BACKUP_ENCRYPTION=${options.encryption ?? 'off'}`))
    assert.equal(observed.rollbacks.length, 0, 'no snapshot/commit before all admission checks pass')
  })
})

test('failed post-rename durability step executes the actual atomic predecessor rollback', () => fixture(dir => {
  const observed = configure(dir, { syncFailure: true })
  assert.equal(observed.result.status, 1)
  assert.equal(observed.config, predecessor)
  assert.equal(observed.rollbacks.length, 1, 'predecessor is kept even after successful rollback')
}))

test('concurrent environment edit is refused rather than overwritten', () => fixture(dir => {
  const observed = configure(dir, { conflict: true })
  assert.equal(observed.result.status, 1)
  assert.equal(observed.config, predecessor + '# concurrent edit\n')
}))

test('workflow uses one protected secret, exact main, inert staging, shared queued lock and no data operation', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/commission-production-backup.yml', import.meta.url), 'utf8')
  assert.match(workflow, /- configure-b2-writer/)
  assert.match(workflow, /B2_WRITER_ENV: \$\{\{ secrets.BACKUP_B2_WRITER_ENV \}\}/)
  assert.match(workflow, /queue: max/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /\[ "\$GITHUB_SHA" = "\$CURRENT_MAIN_SHA" \]/)
  assert.match(workflow, /printf '%s' "\$B2_WRITER_ENV"/)
  const operation = extract('configure_b2_writer')
  assert.doesNotMatch(operation, /systemctl (start|enable|restart)|pg_dump|psql|run_verified_backup|activate_encryption/)
  assert.match(source, /configure-b2-writer\) configure_b2_writer/)
  assert.match(source, /storage setup refuses a pending commissioning fence/)
})

test('actual failure cleanup cannot recover or mutate a pre-existing commissioning fence for storage setup', () => fixture(dir => {
  const cleanup = extract('cleanup')
  const names = [...new Set([...cleanup.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map(match => match[1]))]
  const initializers = names.map(name => `${name}=${/_(HELD|MASKED|CREATED|COMMITTED|REPLACED)$/.test(name) ? '0' : "''"}`).join('\n')
  const fence = join(dir, 'pending-fence')
  writeFileSync(fence, 'must remain untouched', { mode: 0o600 })
  const result = spawnSync('bash', ['-c', `set -u
${cleanup}
${initializers}
OPERATION=configure-b2-writer COMMISSION_FENCE_JOURNAL="$1"
clear_commission_runner_fence() { echo unsafe; exit 99; }
safe_remove_stage_tree() { echo unsafe; exit 99; }
systemctl() { echo unsafe; exit 99; }
false
cleanup
`, 'test', fence], { encoding: 'utf8', env: environment, timeout: 5000 })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.stdout + result.stderr, '')
  assert.equal(readFileSync(fence, 'utf8'), 'must remain untouched')
}))
