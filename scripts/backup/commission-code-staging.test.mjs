import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const source = readFileSync(new URL('./commission-production-backup.sh', import.meta.url), 'utf8')
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
function extract(name) {
  const matches = [...source.matchAll(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'gm'))]
  assert.equal(matches.length, 1, name)
  return matches[0][0]
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-code-stage-test-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function bundle(root, mutate = false) {
  const tree = join(root, 'bundle'), manifest = 'ops/backup/recovery-program-set.files'
  const members = readFileSync(join(repo, manifest), 'utf8').trim().split('\n')
  for (const file of [manifest, ...members]) {
    mkdirSync(dirname(join(tree, file)), { recursive: true })
    copyFileSync(join(repo, file), join(tree, file))
  }
  const hashes = Object.fromEntries([
    ['POSTGRES_BACKUP_SHA256', 'postgres-backup.sh'], ['RESTORE_CANARY_SHA256', 'postgres-restore-canary.sh'],
    ['CANARY_SQL_SHA256', 'canary.sql'], ['SECRETS_SNAPSHOT_SHA256', 'snapshot-secrets.sh'],
    ['RUNTIME_FILES_SNAPSHOT_SHA256', 'snapshot-runtime-files.sh'],
  ].map(([key, file]) => [key, digest(join(tree, 'scripts/backup', file))]))
  writeFileSync(join(tree, 'recovery-db-contract.tsv'), 'synthetic\tdatabase-contract\n')
  writeFileSync(join(tree, 'recovery-db-contract.sha256'), digest(join(tree, 'recovery-db-contract.tsv')) + '\n')
  if (mutate) writeFileSync(join(tree, 'scripts/backup/canary.sql'), '-- unreviewed alteration\n')
  const archive = join(root, 'programs.tar')
  const result = spawnSync('tar', ['-cf', archive, '-C', tree, manifest, ...members, 'recovery-db-contract.tsv', 'recovery-db-contract.sha256'], { env: environment, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  return { archive, hashes }
}
function execute(root, { action = 'prepare', parent = join(root, 'tools'), runId = '12345', wrongOwner = '', mutate = false, runRoot = join(root, 'run'), cleanupPath = '' } = {}) {
  const { archive, hashes } = bundle(root, mutate)
  // Only root identity/chown/install ownership are simulated for a non-root
  // fixture. Modes, canonical paths, atomic mkdir, tar, executable invocation,
  // real hash helpers and cleanup execute unchanged against synthetic files.
  const functions = ['fatal', 'assert_root_directory', 'safe_remove_stage_tree', 'prepare_commission_code']
    .map(extract).join('\n').replaceAll('/run/leaddrive-backup-commission-code-', `${runRoot}/leaddrive-backup-commission-code-`)
  const result = spawnSync('bash', ['-c', `set -Eeuo pipefail
umask 077
${functions}
stat() {
  if [ "$1" = -c ] && [ "$2" = %u ]; then
    if [ "$3" = "$WRONG_OWNER" ]; then printf '1001\\n'; else printf '0\\n'; fi
  else command stat "$@"; fi
}
chown() { :; }
install() {
  local -a args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac
  done
  command install "\${args[@]}"
}
CODE_STAGE=""
SIGNED_DIR="$ROOT/signed" AGE_ROOT="$TOOLS_ROOT/age/1.3.2" AWS_ROOT="$TOOLS_ROOT/aws-cli/2.36.40"
case "$ACTION" in
  prepare) trap 'status=$?; [ -z "$CODE_STAGE" ] || printf "%s\\n" "$CODE_STAGE" >"$ROOT/owned-stage"; exit "$status"' EXIT; prepare_commission_code; printf '%s\\n' "$COMMISSION_RECOVERY_PROGRAM_SET_SHA256";;
  cleanup) safe_remove_stage_tree "$CLEANUP_PATH";;
esac
`, 'staging-test'], {
    env: { ...environment, ...hashes, ROOT: root, TOOLS_ROOT: parent, WORKFLOW_RUN_ID: runId,
      INCOMING_CODE_BUNDLE: archive, WRONG_OWNER: wrongOwner, ACTION: action,
      CLEANUP_PATH: cleanupPath },
    encoding: 'utf8', timeout: 10000,
  })
  return result
}

test('actual preparation uses an owned executable tools child, not plaintext /run', () => fixture(root => {
  mkdirSync(join(root, 'tools'), { mode: 0o755 })
  const result = execute(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^[0-9a-f]{64}\n$/)
  assert.equal(readFileSync(join(root, 'owned-stage'), 'utf8').trim(), join(root, 'tools/commission-code-12345'))
  assert.equal(existsSync(join(root, 'run')), false)
}))

test('preparation rejects missing, writable, symlinked, noncanonical or non-root tools parent', () => {
  for (const kind of ['missing', 'writable', 'symlink', 'prefix-symlink', 'owner']) fixture(root => {
    let parent = join(root, 'tools')
    if (kind === 'symlink') { mkdirSync(join(root, 'other')); symlinkSync(join(root, 'other'), parent) }
    else if (kind === 'prefix-symlink') {
      mkdirSync(join(root, 'real/tools'), { recursive: true, mode: 0o755 }); symlinkSync(join(root, 'real'), join(root, 'alias'))
      parent = join(root, 'alias/tools')
    } else if (kind !== 'missing') mkdirSync(parent, { mode: 0o755 })
    if (kind === 'writable') chmodSync(parent, 0o777)
    const result = execute(root, { parent, wrongOwner: kind === 'owner' ? parent : '' })
    assert.notEqual(result.status, 0, kind)
    assert.equal(existsSync(join(root, 'owned-stage')), false, `${kind}: must not acquire cleanup ownership`)
  })
})

test('pre-existing stage and symlink are never acquired or deleted; invalid run IDs fail closed', () => {
  for (const kind of ['directory', 'symlink', 'invalid']) fixture(root => {
    mkdirSync(join(root, 'tools'), { mode: 0o755 })
    const stage = join(root, 'tools/commission-code-12345')
    mkdirSync(join(root, 'preserve')); writeFileSync(join(root, 'preserve/sentinel'), 'preserve')
    if (kind === 'directory') { mkdirSync(stage); writeFileSync(join(stage, 'sentinel'), 'preserve') }
    if (kind === 'symlink') symlinkSync(join(root, 'preserve'), stage)
    const result = execute(root, { runId: kind === 'invalid' ? '../escape' : '12345' })
    assert.notEqual(result.status, 0, kind)
    assert.equal(existsSync(join(root, 'owned-stage')), false)
    assert.equal(readFileSync(join(root, 'preserve/sentinel'), 'utf8'), 'preserve')
    if (kind !== 'invalid') assert.equal(existsSync(stage), true)
  })
})

test('actual reviewed helper hashes still reject modified code', () => fixture(root => {
  mkdirSync(join(root, 'tools'), { mode: 0o755 })
  const result = execute(root, { mutate: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match the reviewed commissioning hashes/)
}))

test('cleanup accepts only the canonical current numeric run child and preserves neighbors', () => {
  for (const kind of ['own', 'neighbor', 'symlink', 'writable-parent', 'prefix-symlink', 'invalid-id']) fixture(root => {
    mkdirSync(join(root, 'tools'), { mode: 0o755 }); mkdirSync(join(root, 'preserve'))
    writeFileSync(join(root, 'preserve/sentinel'), 'preserve')
    let parent = join(root, 'tools')
    if (kind === 'prefix-symlink') { symlinkSync(parent, join(root, 'alias')); parent = join(root, 'alias') }
    const path = join(parent, kind === 'neighbor' ? 'commission-code-123456' : 'commission-code-12345')
    if (kind === 'symlink') symlinkSync(join(root, 'preserve'), path)
    else { mkdirSync(path, { mode: 0o755 }); writeFileSync(join(path, 'sentinel'), 'preserve') }
    if (kind === 'writable-parent') chmodSync(parent, 0o777)
    const result = execute(root, { action: 'cleanup', parent, cleanupPath: path, runId: kind === 'invalid-id' ? '12345/..' : '12345' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(path), kind !== 'own', kind)
    assert.equal(readFileSync(join(root, 'preserve/sentinel'), 'utf8'), 'preserve')
  })
})

test('kernel noexec plaintext staging does not prevent execution from tools authority', {
  skip: process.env.LEADDRIVE_TEST_NOEXEC_ROOT ? false : 'requires the isolated hosted Linux noexec mount; not simulated locally',
}, () => fixture(root => {
  const runRoot = mkdtempSync(join(process.env.LEADDRIVE_TEST_NOEXEC_ROOT, 'code-stage-'))
  try {
    const probe = join(runRoot, 'probe.sh')
    writeFileSync(probe, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const denied = spawnSync('bash', ['-c', '"$1"', 'noexec-probe', probe], { env: environment, encoding: 'utf8', timeout: 5000 })
    assert.equal(denied.status, 126, 'kernel must really refuse executable files on the plaintext mount')
    mkdirSync(join(root, 'tools'), { mode: 0o755 })
    const result = execute(root, { runRoot })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(root, 'owned-stage'), 'utf8').trim(), join(root, 'tools/commission-code-12345'))
    assert.equal(existsSync(join(runRoot, 'leaddrive-backup-commission-code-12345')), false)
  } finally { rmSync(runRoot, { recursive: true, force: true }) }
}))
