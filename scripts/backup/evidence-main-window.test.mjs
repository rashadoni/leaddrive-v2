import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const windowScript = join(root, 'scripts/backup/evidence-main-window.sh')
const workflow = readFileSync(join(root, '.github/workflows/owner-recovery-proof.yml'), 'utf8')
const controller = readFileSync(join(root, 'scripts/backup/commission-production-backup.sh'), 'utf8')
const env = { PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function commit(dir, path, text, message) {
  mkdirSync(join(dir, dirname(path)), { recursive: true })
  writeFileSync(join(dir, path), text)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}
function window(dir, evidence, current) {
  return spawnSync('bash', [windowScript, evidence, current], { cwd: dir, env, encoding: 'utf8' })
}

test('earlier main is accepted only as an ancestor with byte-identical recovery code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-evidence-window-'))
  try {
    git(dir, 'init', '-q', '-b', 'main')
    const base = commit(dir, 'scripts/backup/postgres-backup.sh', 'v1\n', 'base')
    const unrelated = commit(dir, 'src/app/page.tsx', 'whatsapp\n', 'unrelated product change')
    const prisma = commit(dir, 'prisma/migrations/20990101000000_x/migration.sql', 'SELECT 1;\n', 'new migration')
    assert.equal(window(dir, base, base).status, 0, 'same SHA')
    assert.equal(window(dir, base, unrelated).status, 0, 'product change only')
    assert.equal(window(dir, base, prisma).status, 0, 'migrations are bound by the candidate contract, not by this window')

    for (const path of ['scripts/backup/postgres-backup.sh', 'scripts/backup/new-helper.sh',
      'ops/backup/owner-workstation.Dockerfile', 'ops/systemd/leaddrive-postgres-backup.service',
      '.github/actions/setup-production-ssh/action.yml', '.github/workflows/owner-recovery-proof.yml']) {
      git(dir, 'checkout', '-q', prisma)
      const changed = commit(dir, path, `changed ${path}\n`, `touch ${path}`)
      const result = window(dir, base, changed)
      assert.notEqual(result.status, 0, `${path} must invalidate earlier evidence`)
      assert.match(result.stderr, /recovery code changed/)
    }

    git(dir, 'checkout', '-q', base)
    const side = commit(dir, 'docs/side.md', 'side\n', 'side branch')
    assert.notEqual(window(dir, side, prisma).status, 0, 'non-ancestor')
    assert.notEqual(window(dir, prisma, base).status, 0, 'newer evidence than the run')
    assert.notEqual(window(dir, 'f'.repeat(40), prisma).status, 0, 'unknown commit')
    for (const bad of ['', 'HEAD', base.slice(0, 12), base.toUpperCase()]) {
      assert.notEqual(window(dir, bad, prisma).status, 0, `malformed ${bad}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('workflow proves the window before staging and hands the earlier SHA to every binding', () => {
  const bind = workflow.slice(workflow.indexOf('- name: Bind operation to the exact current main revision'))
  const bindStep = bind.slice(0, bind.indexOf('\n      - name:', 10))
  assert.match(bindStep, /\[ "\$GITHUB_SHA" = "\$CURRENT_MAIN_SHA" \] && \[ "\$EXPECTED_MAIN_SHA" = "\$CURRENT_MAIN_SHA" \]/,
    'the run itself is still pinned to the exact current main')
  assert.match(bindStep, /bash scripts\/backup\/evidence-main-window\.sh "\$EVIDENCE_MAIN_SHA" "\$GITHUB_SHA"/)
  assert.match(bindStep, /EVIDENCE_MAIN_SHA=%s\\n' "\$EVIDENCE_MAIN_SHA" >>"\$GITHUB_ENV"/)
  assert.match(workflow, /owner-key-proof\.mjs verify \\\n[^\n]*\n\s+"\$STAGE_DIR\/allowed_signers" "\$RECIPIENT_SHA256" "\$EVIDENCE_MAIN_SHA" "\$GITHUB_ACTOR"/)
  assert.match(workflow, /"\$OFFLINE_OPERATOR" "\$CANDIDATE_SHA256" "\$REMOTE_STAGE_DIR" "\$OWNER_RECIPIENT" \\\n\s+"\$EVIDENCE_MAIN_SHA"; do/)
})

test('controller defaults to the run SHA, admits an earlier SHA only for owner operations, and uses it for every binding', () => {
  const prologue = controller.slice(controller.indexOf('[ -n "$EVIDENCE_MAIN_SHA" ] || EVIDENCE_MAIN_SHA="$WORKFLOW_SHA"'))
  const block = prologue.slice(0, prologue.indexOf('\nfi\n') + 4)
  const run = (operation, evidence) => spawnSync('bash', ['-c', `set -euo pipefail
fatal() { printf '%s\\n' "$*" >&2; exit 1; }
WORKFLOW_SHA=${'1'.repeat(40)} OPERATION="$1" EVIDENCE_MAIN_SHA="$2"
${block}
printf '%s' "$EVIDENCE_MAIN_SHA"`, 'x', operation, evidence], { env, encoding: 'utf8' })
  assert.equal(run('run-verified-backup', '').stdout, '1'.repeat(40), 'empty means this run')
  assert.equal(run('certify-owner-restore', '2'.repeat(40)).stdout, '2'.repeat(40))
  assert.equal(run('run-owner-backup', '2'.repeat(40)).status, 0)
  for (const operation of ['run-verified-backup', 'certify-offline-restore', 'configure-b2-writer', 'probe-native-scratch']) {
    assert.notEqual(run(operation, '2'.repeat(40)).status, 0, `${operation} keeps the exact-run binding`)
  }
  assert.notEqual(run('certify-owner-restore', 'not-a-sha').status, 0)

  assert.match(controller, /REVIEWED_MAIN_SHA\)" = "\$EVIDENCE_MAIN_SHA" \] \\\n\s+\|\| fatal "signed offline evidence does not match the commissioned operation"/)
  assert.match(controller, /"\$EXPECTED_RECIPIENT_SHA256" "\$EVIDENCE_MAIN_SHA" "\$WORKFLOW_ACTOR" >\/dev\/null \\\n\s+\|\| fatal "owner key-readability signature\/proof did not verify"/)
  assert.match(controller, /candidate_file" WORKFLOW_SHA\)" = "\$EVIDENCE_MAIN_SHA" \]/)
  assert.match(controller, /"REVIEWED_MAIN_SHA=\$WORKFLOW_SHA" "CANDIDATE_MAIN_SHA=\$EVIDENCE_MAIN_SHA"/)
  // Live-artifact checks stay on the run's own SHA.
  assert.match(controller, /\.deploy-sha\)" = "\$WORKFLOW_SHA"/)
})
