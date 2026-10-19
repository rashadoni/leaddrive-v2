import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { namespace, parseKeyEvidence, verifyKeyProof } from './owner-key-proof.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const verifier = join(root, 'scripts/backup/owner-key-proof.mjs')
const sha = (data) => createHash('sha256').update(data).digest('hex')
const verifierSha = sha(readFileSync(verifier))
const mainSha = '1'.repeat(40), recipientSha = '2'.repeat(64), owner = 'synthetic-owner'
const env = { PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C' }
const now = Date.parse('2026-10-19T00:00:00Z')
function evidence(overrides = {}) {
  const data = { FORMAT_VERSION: '1', EVIDENCE_TYPE: 'owner-key-readability', STATUS: 'verified',
    OPERATOR_MODEL: 'owner_operated', INDEPENDENT_HUMAN_REVIEW: 'not_performed',
    TWO_OFFLINE_MEDIA: 'not_met', KEY_READABILITY_STATUS: 'passed',
    RECIPIENT_SHA256: recipientSha, OWNER_KEY_VERIFIER_SHA256: verifierSha,
    REVIEWED_MAIN_SHA: mainSha, OWNER_OPERATOR: owner,
    VERIFIED_AT_UTC: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'), ...overrides }
  return Object.entries(data).map(([key, value]) => `${key}=${value}\n`).join('')
}
const expected = { recipientSha, mainSha, owner, verifierSha, now }
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { env, encoding: 'utf8', timeout: 15000, ...options })
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr)
  return result
}
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-owner-proof-test-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function keys(dir, suffix = '') {
  const key = join(dir, `key${suffix}`)
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
  const pub = readFileSync(`${key}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ')
  return { key, pub }
}

test('owner schema is exact, bounded and cannot assert independence/offline custody', () => {
  const bytes = evidence({ VERIFIED_AT_UTC: '2026-10-19T00:00:00Z' })
  assert.equal(parseKeyEvidence(bytes, expected).OPERATOR_MODEL, 'owner_operated')
  for (const override of [{ EVIDENCE_TYPE: 'age-key-custody' }, { INDEPENDENT_HUMAN_REVIEW: 'passed' },
    { TWO_OFFLINE_MEDIA: 'confirmed' }, { OPERATOR_MODEL: 'independent' }, { KEY_READABILITY_STATUS: 'not_tested' },
    { RECIPIENT_SHA256: '3'.repeat(64) }, { REVIEWED_MAIN_SHA: '3'.repeat(40) }, { OWNER_OPERATOR: 'other' },
    { OWNER_KEY_VERIFIER_SHA256: '3'.repeat(64) }, { VERIFIED_AT_UTC: '2026-10-17T00:00:00Z' },
    { VERIFIED_AT_UTC: '2026-10-19T00:05:01Z' }, { VERIFIED_AT_UTC: '2026-02-30T00:00:00Z' }]) {
    assert.throws(() => parseKeyEvidence(evidence({ VERIFIED_AT_UTC: '2026-10-19T00:00:00Z', ...override }), expected))
  }
  for (const invalid of [bytes + 'STATUS=verified\n', bytes.slice(0, -1), bytes.replace('STATUS=verified', 'STATUS=verified\r'),
    bytes.replace('OWNER_OPERATOR=synthetic-owner', 'OWNER_OPERATOR=$(echo forbidden)'), 'x'.repeat(4097)]) {
    assert.throws(() => parseKeyEvidence(invalid, expected))
  }
})

test('real SSH signature requires exact owner namespace, external signer and untampered bytes', () => fixture((dir) => {
  const { key, pub } = keys(dir)
  const other = keys(dir, '-other')
  const receipt = join(dir, 'receipt.env'), signers = join(dir, 'allowed-signers')
  writeFileSync(receipt, evidence(), { mode: 0o600 })
  writeFileSync(signers, `${owner} ${pub}\n`, { mode: 0o600 })
  const verify = () => verifyKeyProof({ evidence: receipt, signature: `${receipt}.sig`, signers, recipientSha, mainSha, owner })
  run('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', namespace, receipt])
  assert.equal(verify(), sha(readFileSync(receipt)))
  writeFileSync(signers, `${owner} ${other.pub}\n`)
  assert.throws(verify)
  writeFileSync(signers, `${owner} ${pub}\n`)
  writeFileSync(receipt, evidence({ STATUS: 'unverified' }))
  assert.throws(verify)
  writeFileSync(receipt, evidence())
  rmSync(`${receipt}.sig`)
  run('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'leaddrive-backup-evidence', receipt])
  assert.throws(verify, /cryptographic command failed/u)
  rmSync(`${receipt}.sig`)
  run('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', namespace, receipt])
  const link = join(dir, 'linked-receipt'); symlinkSync(receipt, link)
  assert.throws(() => verifyKeyProof({ evidence: link, signature: `${receipt}.sig`, signers, recipientSha, mainSha, owner }))
  writeFileSync(signers, `${owner} ${pub}\n${owner} ${other.pub}\n`)
  assert.throws(verify, /exactly one/u)
}))

test('owner flags cannot be inherited from environment or accept arbitrary/extra recipient args', () => {
  for (const script of ['postgres-backup.sh', 'snapshot-secrets.sh', 'snapshot-runtime-files.sh']) {
    for (const args of [['--owner-operated'], ['--owner-operated', 'bad'], ['--owner-operated', `age1${'a'.repeat(58)}`, 'extra']]) {
      const result = spawnSync('bash', [join(root, 'scripts/backup', script), ...args], { env, encoding: 'utf8', timeout: 5000 })
      assert.equal(result.status, 2, `${script} refuses malformed CLI before config/DB access`)
    }
    const source = readFileSync(join(root, 'scripts/backup', script), 'utf8')
    assert.ok(source.includes('OWNER_RECIPIENT=""'), 'no inherited mode/public-key override')
    assert.ok(source.includes('BACKUP_ENV_FILE must remain /etc/leaddrive/backup.env'))
  }
})

test('owner offline interface rejects full/log claim before touching archives or keys', () => {
  const result = spawnSync('bash', [join(root, 'scripts/backup/verify-offline-backup.sh'), '--owner-operated', ...Array(14).fill('synthetic')], { env, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /data-only 12-argument/u)
})

const commission = readFileSync(join(root, 'scripts/backup/commission-production-backup.sh'), 'utf8')
function extract(name) {
  const matches = [...commission.matchAll(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'gm'))]
  assert.equal(matches.length, 1)
  return matches[0][0]
}
test('actual owner preflight rejects impersonation and omitted policy acknowledgement', () => {
  const helper = extract('assert_owner_evidence_inputs')
  for (const [actor, operator, policy, expectedStatus] of [
    [owner, owner, 'OWNER_OPERATED_ONLINE_CUSTODY_ACCEPTED', 0],
    [owner, 'another-owner', 'OWNER_OPERATED_ONLINE_CUSTODY_ACCEPTED', 1],
    [owner, owner, 'TWO_READABLE_OFFLINE_COPIES_AND_INDEPENDENT_DECRYPT_CONFIRMED', 1],
  ]) {
    const result = spawnSync('bash', ['-c', `set -euo pipefail
fatal() { exit 1; }
${helper}
KEY_CUSTODY_ATTESTATION="$1" OFFLINE_OPERATOR="$2" WORKFLOW_ACTOR="$3"
EXPECTED_RECIPIENT_SHA256="${recipientSha}" EVIDENCE_REF=synthetic
EVIDENCE_AT_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
assert_owner_evidence_inputs`, 'test', policy, operator, actor], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, expectedStatus)
  }
})
test('actual owner boundary refuses commissioned host and any enabled/active timer', () => {
  const helper = extract('assert_owner_source_boundary')
  for (const [encryption, enabled, active, expectedStatus] of [
    ['off', 'disabled', 'inactive', 0], ['age', 'disabled', 'inactive', 1],
    ['off', 'enabled', 'inactive', 1], ['off', 'disabled', 'active', 1],
  ]) {
    const result = spawnSync('bash', ['-c', `set -euo pipefail
fatal() { exit 1; }
read_unique_value() { printf '%s' "$ENC"; }
systemctl() { case "$*" in *LoadState*) echo loaded;; is-enabled*) echo "$ENABLED";; is-active*) echo "$ACTIVE";; *) exit 1;; esac; }
BACKUP_TIMER=db SECRETS_TIMER=secrets RUNTIME_FILES_TIMER=runtime LOG_TIMER=logs
${helper}
assert_owner_source_boundary`], { env: { ...env, ENC: encryption, ENABLED: enabled, ACTIVE: active }, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, expectedStatus)
  }
})

test('owner route remains separate, main-bound and cannot publish independent markers or enable schedules', () => {
  const workflow = readFileSync(join(root, '.github/workflows/owner-recovery-proof.yml'), 'utf8')
  assert.ok(workflow.includes('secrets.BACKUP_OWNER_ALLOWED_SIGNERS'))
  assert.ok(!workflow.includes('secrets.BACKUP_OFFLINE_ALLOWED_SIGNERS'))
  assert.ok(workflow.includes('group: production-deploy'))
  assert.ok(workflow.includes('[ "$GITHUB_SHA" = "$CURRENT_MAIN_SHA" ]'))
  assert.ok(workflow.includes('[ "$IN_OFFLINE_OPERATOR" = "$GITHUB_ACTOR" ]'))
  assert.ok(workflow.includes('"$REMOTE_STAGE_DIR" "$OWNER_RECIPIENT"'))
  const certify = extract('certify_owner_restore')
  for (const forbidden of ['systemctl enable', 'CURRENT_RESTORE_MARKER', 'BOOTSTRAP_RESTORE_MARKER', 'commit_commission_timer', 'BACKUP_ENV_FILE', 'publish_recovery_catalog']) assert.ok(!certify.includes(forbidden))
  for (const required of ['verify_signed_evidence owner-archive-restore', 'assert_candidate_remote_objects',
    'INDEPENDENT_READY=no', 'ENTERPRISE_GA_READY=no', 'ln -- "$MARKER_STAGE" "$target"']) assert.ok(certify.includes(required))
})

// Opt-in real age test in bounded CI/local tool installation. Synthetic keys only.
test('real pinned age key-readability proof signs and verifies without exposing identity', { skip: process.env.LEADDRIVE_OWNER_AGE_INTEGRATION !== '1' }, () => fixture((dir) => {
  const { key, pub } = keys(dir)
  const identity = join(dir, 'identity.agekey'), output = join(dir, 'proof.env'), signers = join(dir, 'signers')
  run('age-keygen', ['-o', identity])
  const recipient = run('age-keygen', ['-y', identity]).stdout.trim()
  const digest = sha(recipient)
  writeFileSync(signers, `${owner} ${pub}\n`, { mode: 0o600 })
  const result = run('node', [verifier, 'create', identity, key, digest, mainSha, owner, output])
  assert.ok(!result.stdout.includes('AGE-SECRET-KEY-'))
  assert.equal(verifyKeyProof({ evidence: output, signature: `${output}.sig`, signers, recipientSha: digest, mainSha, owner }), sha(readFileSync(output)))
  const repeated = spawnSync('node', [verifier, 'create', identity, key, digest, mainSha, owner, output], { env, encoding: 'utf8', timeout: 15000 })
  assert.equal(repeated.status, 1)
  assert.ok(existsSync(output) && existsSync(`${output}.sig`))
  const link = join(dir, 'identity-link'); symlinkSync(identity, link)
  const linked = spawnSync('node', [verifier, 'create', link, key, digest, mainSha, owner, join(dir, 'bad.env')], { env, encoding: 'utf8', timeout: 15000 })
  assert.equal(linked.status, 1)
  assert.ok(!existsSync(join(dir, 'bad.env')))
}))

test('actual archive admission verifies owner signature and rejects cross-mode certificate/scope', () => fixture((dir) => {
  // Synthetic assertions exercise signature/admission only, never claim a restore.
  const { key, pub } = keys(dir)
  const receipt = join(dir, 'evidence.env'), candidate = join(dir, 'candidate.env')
  const signers = join(dir, 'allowed-signers'), bundle = join(dir, 'evidence.tar')
  writeFileSync(signers, `${owner} ${pub}\n`, { mode: 0o600 })
  const d = 'a'.repeat(64)
  const binding = { FORMAT_VERSION: '2', RECOVERY_SCOPE: 'owner-operated-data-only',
    DATABASE_CIPHERTEXT_SHA256: d, SECRETS_CIPHERTEXT_SHA256: d, RUNTIME_FILES_CIPHERTEXT_SHA256: d,
    SOURCE_APP_ENV_SHA256: d, SOURCE_BACKUP_ENV_SHA256: d, SOURCE_MIGRATION_ENV_SHA256: d,
    OBJECT_BUCKET: 'synthetic-bucket', DATABASE_OBJECT_KEY: 'db.tar.age', DATABASE_OBJECT_VERSION_ID: 'db-version',
    DATABASE_RETAIN_UNTIL: '2028-01-01T00:00:00Z', SECRETS_OBJECT_KEY: 'secrets.tar.age',
    SECRETS_OBJECT_VERSION_ID: 'secrets-version', SECRETS_RETAIN_UNTIL: '2028-01-01T00:00:00Z',
    RUNTIME_FILES_OBJECT_KEY: 'runtime.tar.age', RUNTIME_FILES_OBJECT_VERSION_ID: 'runtime-version',
    RUNTIME_FILES_RETAIN_UNTIL: '2028-01-01T00:00:00Z', RUNTIME_FILES_INVENTORY_SHA256: d,
    RUNTIME_FILES_FILE_COUNT: '2', SOURCE_DATABASE_IDENTITY_SHA256: d, COMMISSION_CODE_BUNDLE_SHA256: d,
    SOURCE_MIGRATION_LEDGER_SHA256: d, RECOVERY_PROGRAM_SET_SHA256: d, RECOVERY_DB_CONTRACT_SHA256: d }
  const serialize = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join('')
  writeFileSync(candidate, serialize(binding), { mode: 0o600 })
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const claims = { ...binding, FORMAT_VERSION: '1', EVIDENCE_TYPE: 'owner-archive-restore', STATUS: 'verified',
    RECIPIENT_SHA256: recipientSha, EVIDENCE_REF: 'synthetic-fixture', OFFLINE_OPERATOR: owner,
    VERIFIED_AT_UTC: timestamp, REVIEWED_MAIN_SHA: mainSha, CANDIDATE_SHA256: sha(readFileSync(candidate)),
    DECRYPT_STATUS: 'passed', INTERNAL_CHECKSUM_STATUS: 'passed', SCRATCH_RESTORE_STATUS: 'passed', TENANT_CANARY_STATUS: 'passed',
    DATABASE_AUTHORITY_CATALOG_STATUS: 'captured_and_bound', MIGRATION_LEDGER_RESTORE_STATUS: 'passed',
    RLS_FORCE_RLS_CATALOG_STATUS: 'passed', FULL_AUTHORITY_RESTORE_STATUS: 'not_tested', DATABASE_AUTHORITY_CATALOG_SHA256: d,
    PII_DECRYPT_STATUS: 'passed', NEXTAUTH_SECRET_RECOVERY_STATUS: 'passed', RUNTIME_FILES_DECRYPT_STATUS: 'passed',
    RUNTIME_FILES_INVENTORY_STATUS: 'passed', DATABASE_STORAGE_ATTESTATION: 'DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED',
    ARCHIVE_VERIFIER_SHA256: d, RESTORE_CANARY_SHA256: d, PII_PROOF_SHA256: d, CANARY_SQL_SHA256: d,
    INTEGRATION_TOKEN_DECRYPT_STATUS: 'not_applicable_no_persisted_ciphertext',
    OPERATOR_MODEL: 'owner_operated', INDEPENDENT_HUMAN_REVIEW: 'not_performed', TWO_OFFLINE_MEDIA: 'not_met' }
  function sign(overrides = {}, ns = namespace) {
    writeFileSync(receipt, serialize({ ...claims, ...overrides }))
    rmSync(`${receipt}.sig`, { force: true })
    run('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', ns, receipt])
    run('tar', ['-C', dir, '-cf', bundle, 'evidence.env', 'evidence.env.sig'])
  }
  const fn = extract('verify_signed_evidence')
  const script = `set -euo pipefail
fatal() { printf '%s\\n' "$*" >&2; exit 1; }
assert_root_file() { test -f "$2" && test ! -L "$2"; }
# Only synthetic archive's uid is emulated; real tar, SSH and all bindings run.
stat() { if [ "$1" = -c ] && [ "$2" = %u ] && [ "$3" = "$INCOMING_EVIDENCE_BUNDLE" ]; then echo 0; else command stat "$@"; fi; }
read_unique_value_from() { awk -F= -v key="$2" '$1==key {if(n++)exit 2; print substr($0,length(key)+2)}' "$1"; }
${fn}
INCOMING_EVIDENCE_BUNDLE="$1" OFFLINE_ALLOWED_SIGNERS="$2"
OFFLINE_OPERATOR="${owner}" EVIDENCE_REF=synthetic-fixture EVIDENCE_AT_UTC="$3"
WORKFLOW_SHA="${mainSha}" EXPECTED_CANDIDATE_SHA256="$4" OPERATION=certify-owner-restore
ARCHIVE_VERIFIER_SHA256="${d}" RESTORE_CANARY_SHA256="${d}" PII_PROOF_SHA256="${d}" CANARY_SQL_SHA256="${d}"
verify_signed_evidence "$5" "${recipientSha}" "$6"
# Cleanup is confined to this invocation's synthetic private work tree.
case "$WORK_DIR" in /var/tmp/leaddrive-backup-evidence.*) rm -rf -- "$WORK_DIR";; *) exit 2;; esac
`
  function admission(type = 'owner-archive-restore') {
    // TMPDIR cannot change verifier's fixed /var/tmp prefix; clean known fixture
    // dirs through a trap even for intentionally rejected synthetic receipts.
    const trapped = script.replace('INCOMING_EVIDENCE_BUNDLE="$1"', `trap 'if [ -n "\${WORK_DIR:-}" ]; then case "$WORK_DIR" in /var/tmp/leaddrive-backup-evidence.*) rm -rf -- "$WORK_DIR";; esac; fi' EXIT\nINCOMING_EVIDENCE_BUNDLE="$1"`)
    return spawnSync('bash', ['-c', trapped, 'fixture', bundle, signers, timestamp, sha(readFileSync(candidate)), type, candidate], { env, encoding: 'utf8', timeout: 15000 })
  }
  sign()
  let result = admission(); assert.equal(result.status, 0, result.stderr)
  assert.notEqual(admission('archive-restore').status, 0, 'owner signature never admits independent receipt')
  sign({ INDEPENDENT_HUMAN_REVIEW: 'passed' }); assert.notEqual(admission().status, 0)
  sign({ TWO_OFFLINE_MEDIA: 'confirmed' }); assert.notEqual(admission().status, 0)
  sign({ TENANT_CANARY_STATUS: 'failed' }); assert.notEqual(admission().status, 0)
  sign({}, 'leaddrive-backup-evidence'); assert.notEqual(admission().status, 0, 'wrong namespace denied')
  sign({ EVIDENCE_TYPE: 'archive-restore', RECOVERY_SCOPE: 'log-genesis-bootstrap-only' }, 'leaddrive-backup-evidence')
  assert.notEqual(admission('archive-restore').status, 0, 'owner candidate scope cannot enter independent admission even with independent-looking signature')
  writeFileSync(candidate, serialize({ ...binding, RECOVERY_SCOPE: 'log-genesis-bootstrap-only' }))
  const independent = { ...claims, EVIDENCE_TYPE: 'archive-restore', RECOVERY_SCOPE: 'log-genesis-bootstrap-only',
    CANDIDATE_SHA256: sha(readFileSync(candidate)) }
  for (const field of ['OPERATOR_MODEL', 'INDEPENDENT_HUMAN_REVIEW', 'TWO_OFFLINE_MEDIA']) delete independent[field]
  writeFileSync(receipt, serialize(independent))
  rmSync(`${receipt}.sig`)
  run('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'leaddrive-backup-evidence', receipt])
  run('tar', ['-C', dir, '-cf', bundle, 'evidence.env', 'evidence.env.sig'])
  result = admission('archive-restore')
  assert.equal(result.status, 0, 'existing independent archive verification still accepts its original scope/signature/claims: ' + result.stderr)
}))

test('actual interrupted-fence recovery recognizes owner backup journal and rejects unknown operations', () => fixture((dir) => {
  const journal = join(dir, 'runner-fence.env')
  const services = { BACKUP: 'synthetic-owner-db.service', SECRETS: 'synthetic-owner-secrets.service',
    RUNTIME_FILES: 'synthetic-owner-runtime.service', LOG: 'synthetic-owner-log.service' }
  const fields = { FORMAT_VERSION: '3', STATUS: 'fencing', ...Object.fromEntries(Object.entries(services).map(([k, v]) => [`${k}_SERVICE`, v])) }
  for (const label of Object.keys(services)) {
    fields[`${label}_TIMER_LOAD_STATE`] = 'loaded'
    fields[`${label}_TIMER_ENABLED_STATE`] = 'disabled'
    fields[`${label}_TIMER_ACTIVE_STATE`] = 'inactive'
  }
  fields.WORKFLOW_RUN_ID = '12345'
  fields.OPERATION = 'run-owner-backup'
  const recover = extract('recover_commission_runner_fence')
  const program = `set -euo pipefail
fatal() { exit 1; }
log() { :; }
assert_root_directory() { test -d "$2" && test ! -L "$2"; }
assert_root_file() { test -f "$2" && test ! -L "$2"; }
read_unique_value_from() { awk -F= -v key="$2" '$1==key {if(n++)exit 2; print substr($0,length(key)+2)}' "$1"; }
systemctl() { case "$*" in *LoadState*) echo not-found;; is-enabled*) echo disabled;; *) exit 1;; esac; }
clear_commission_runner_fence() { printf 'synthetic_cleanup_called\\n'; }
COMMISSION_STATE_ROOT="$1" COMMISSION_FENCE_JOURNAL="$2"
BACKUP_SERVICE=${services.BACKUP} SECRETS_SERVICE=${services.SECRETS}
RUNTIME_FILES_SERVICE=${services.RUNTIME_FILES} LOG_SERVICE=${services.LOG}
${recover}
recover_commission_runner_fence`
  for (const [operation, status] of [['run-owner-backup', 0], ['run-bootstrap-backup', 0], ['unrecognized-command', 1]]) {
    writeFileSync(journal, Object.entries({ ...fields, OPERATION: operation }).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 })
    const result = spawnSync('bash', ['-c', program, 'fixture', dir, journal], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, status)
    assert.equal(result.stdout.includes('synthetic_cleanup_called'), status === 0)
  }
}))

// A real recovery invokes the staged helper, which requires this SQL dependency.
test('private verifier staging includes the reviewed migration SQL dependency', () => {
  const source = readFileSync(join(root, 'scripts/backup/verify-offline-backup.sh'), 'utf8')
  const digest = sha(readFileSync(join(root, 'scripts/backup/migration-ledger.sql')))
  assert.ok(source.includes(`install -m 0600 "$SCRIPT_DIR/migration-ledger.sql" "$WORK_DIR/helpers/migration-ledger.sql"`))
  assert.ok(source.includes(digest))
  assert.ok(source.includes(`"$migration_ledger_sql_sha256"`))
})

test('actual restore dispatch interprets a staged helper without execute permission', () => fixture((dir) => {
  const source = readFileSync(join(root, 'scripts/backup/verify-offline-backup.sh'), 'utf8')
  const invocation = source.match(/^if ! (TMPDIR="\$WORK_DIR" bash "\$SCRIPT_DIR\/postgres-restore-canary.sh")/m)
  assert.ok(invocation, 'scratch restore must work on noexec plaintext mount')
  writeFileSync(join(dir, 'postgres-restore-canary.sh'), 'printf interpreted-helper', { mode: 0o600 })
  const result = spawnSync('bash', ['-c', invocation[1]], { env: { ...env, WORK_DIR: dir, SCRIPT_DIR: dir }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'interpreted-helper')
}))

test('workbench rejects absent, linked, unlimited or nonzero swap limits before private input', () => fixture((dir) => {
  const source = readFileSync(join(root, 'ops/backup/owner-workstation.sh'), 'utf8')
  const guard = source.match(/^assert_swap_disabled\(\) \{[\s\S]*?^\}/m)?.[0]
  assert.ok(guard)
  assert.ok(source.indexOf('assert_swap_disabled /sys/fs/cgroup/memory.swap.max') < source.indexOf('install -m 0600'))
  const limit = join(dir, 'swap.max')
  const execute = (path) => spawnSync('bash', ['-c', `fatal() { exit 1; }\n${guard}\nassert_swap_disabled "$1"`, 'fixture', path], { env, encoding: 'utf8', timeout: 5000 })
  for (const value of ['0\n', '1\n', '1073741824\n', 'max\n', '', '0\n1\n']) {
    writeFileSync(limit, value)
    assert.equal(execute(limit).status, value === '0\n' ? 0 : 1)
  }
  assert.equal(execute(join(dir, 'missing')).status, 1)
  writeFileSync(limit, '0\n')
  const linked = join(dir, 'linked'); symlinkSync(limit, linked)
  assert.equal(execute(linked).status, 1)
}))
