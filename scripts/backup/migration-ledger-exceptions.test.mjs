import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const repo = new URL('../../', import.meta.url).pathname
const read = (path) => readFileSync(join(repo, path), 'utf8')
const backup = read('scripts/backup/postgres-backup.sh')
const canary = read('scripts/backup/postgres-restore-canary.sh')
const verifier = read('scripts/backup/verify-offline-backup.sh')
const generator = join(repo, 'scripts/backup/hash-recovery-db-contract.sh')
const hex = (c) => c.repeat(64)

function exceptionBlock(source) {
  const match = source.match(/^# BEGIN reviewed migration ledger exceptions\n[\s\S]*?^# END reviewed migration ledger exceptions\n/m)
  assert.ok(match, 'reviewed ledger exception block is present')
  return match[0]
}

// The manifest validator is the awk program that ends with this fatal message.
function manifestValidator(source) {
  const end = source.indexOf('|| fatal "recovery DB contract manifest is malformed"')
  const start = source.lastIndexOf("awk -F '\\t' '\n  NR == 1", end)
  assert.ok(start > 0 && end > start, 'manifest validator is present')
  return source.slice(start, source.indexOf("\n'", start) + 2)
}

function bash(script, env = {}) {
  return spawnSync('bash', ['-c', 'set -Eeuo pipefail\n' + script], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', ...env }, encoding: 'utf8', timeout: 20000,
  })
}

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-ledger-exceptions-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

function fixtureRepo(root, migrations, exceptions) {
  mkdirSync(join(root, 'prisma/migrations'), { recursive: true })
  writeFileSync(join(root, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" }\n')
  writeFileSync(join(root, 'prisma/migrations/migration_lock.toml'), 'provider = "postgresql"\n')
  for (const [name, sql] of Object.entries(migrations)) {
    mkdirSync(join(root, 'prisma/migrations', name))
    writeFileSync(join(root, 'prisma/migrations', name, 'migration.sql'), sql)
  }
  if (exceptions !== undefined) writeFileSync(join(root, 'prisma/migration-ledger-exceptions.tsv'), exceptions)
}

function sha256(text) {
  return spawnSync('sha256sum', { input: text, encoding: 'utf8' }).stdout.split(' ')[0]
}

test('backup and restore canary apply byte-identical exception logic; all three validators agree', () => {
  assert.equal(exceptionBlock(backup), exceptionBlock(canary))
  assert.equal(manifestValidator(backup), manifestValidator(canary))
  assert.equal(manifestValidator(backup), manifestValidator(verifier))
  // Exceptions are applied before the unchanged exact prefix comparison.
  for (const source of [backup, canary]) {
    const applied = source.indexOf('apply_reviewed_ledger_exceptions "')
    assert.ok(applied > source.indexOf('# END reviewed migration ledger exceptions'))
    assert.ok(applied < source.indexOf('checksum-matching prefix of the recovery DB contract'))
  }
})

test('repository contract carries the reviewed production exceptions and stays digest-consistent', () => {
  const manifest = spawnSync('bash', [generator, '--manifest', repo], { encoding: 'utf8' })
  assert.equal(manifest.status, 0, manifest.stderr)
  const rows = manifest.stdout.split('\n').filter((line) => line.startsWith('LEDGER_EXCEPTION\t'))
  assert.deepEqual(rows.map((row) => row.split('\t')[1]), [
    '20260330120000_add_vat_fields_to_bill',
    '20260331200000_add_commission_fields',
    '20260331210000_add_contact_role_types',
    '20260411120000_add_tenant_fields',
    '20260415070000_add_kb_embeddings',
    '20260424000000_ai_shadow_pending_uniq_index',
    '20260518120000_health',
  ])
  const digest = spawnSync('bash', [generator, repo], { encoding: 'utf8' })
  assert.equal(digest.stdout.trim(), sha256(manifest.stdout))
  const validated = bash(manifestValidator(backup) + ' "$MANIFEST"', { MANIFEST: join(tmpdir(), 'unused') })
  assert.notEqual(validated.status, 0, 'validator refuses a missing manifest')
  withRoot((root) => {
    writeFileSync(join(root, 'manifest.tsv'), manifest.stdout)
    const ok = bash(manifestValidator(backup) + ' "$MANIFEST"', { MANIFEST: join(root, 'manifest.tsv') })
    assert.equal(ok.status, 0, ok.stderr)
  })
})

test('generator refuses exceptions that contradict the repository or are malformed', () => {
  const migrations = { '20260101000000_a': 'SELECT 1;\n', '20260102000000_b': 'SELECT 2;\n' }
  const bDigest = sha256('SELECT 2;\n')
  const cases = {
    'orphan that exists': `20260101000000_a\t${hex('a')}\tapplied-not-in-code\twhy\n`,
    'checksum that does not differ': `20260102000000_b\t${bDigest}\tchecksum-differs\twhy\n`,
    'checksum for unknown migration': `20260103000000_c\t${hex('a')}\tchecksum-differs\twhy\n`,
    'unknown kind': `20251231000000_z\t${hex('a')}\tignored\twhy\n`,
    'missing reason': `20251231000000_z\t${hex('a')}\tapplied-not-in-code\n`,
    'bad checksum': `20251231000000_z\tmanual\tapplied-not-in-code\twhy\n`,
    'unsorted': `20251231000002_z\t${hex('a')}\tapplied-not-in-code\twhy\n20251231000001_y\t${hex('a')}\tapplied-not-in-code\twhy\n`,
    'duplicate': `20251231000001_y\t${hex('a')}\tapplied-not-in-code\twhy\n20251231000001_y\t${hex('b')}\tapplied-not-in-code\twhy\n`,
  }
  for (const [label, exceptions] of Object.entries(cases)) {
    withRoot((root) => {
      fixtureRepo(root, migrations, exceptions)
      const result = spawnSync('bash', [generator, '--manifest', root], { encoding: 'utf8' })
      assert.notEqual(result.status, 0, label)
      assert.equal(result.stdout, '', `${label}: no partial manifest`)
    })
  }
  withRoot((root) => {
    fixtureRepo(root, migrations)
    writeFileSync(join(root, 'real.tsv'), '')
    symlinkSync(join(root, 'real.tsv'), join(root, 'prisma/migration-ledger-exceptions.tsv'))
    assert.notEqual(spawnSync('bash', [generator, root]).status, 0, 'symlinked exceptions')
  })
  // Without the file the manifest is exactly what it was before exceptions existed.
  withRoot((root) => {
    fixtureRepo(root, migrations)
    const result = spawnSync('bash', [generator, '--manifest', root], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.split('\n').filter(Boolean).length, 4)
    assert.ok(!result.stdout.includes('LEDGER_EXCEPTION'))
  })
})

test('validator refuses exception rows the generator would never emit', () => {
  const head = `SCHEMA\tprisma/schema.prisma\t${hex('1')}\nMIGRATION_LOCK\tprisma/migrations/migration_lock.toml\t${hex('2')}\n`
  const migrations = `MIGRATION\t20260101000000_a\t${hex('a')}\nMIGRATION\t20260102000000_b\t${hex('b')}\n`
  const cases = {
    valid: [0, head + migrations + `LEDGER_EXCEPTION\t20251231000000_z\tmanual-20251231000000\tapplied-not-in-code\nLEDGER_EXCEPTION\t20260102000000_b\t${hex('c')}\tchecksum-differs\n`],
    'exception before migrations': [1, head + `LEDGER_EXCEPTION\t20251231000000_z\t${hex('c')}\tapplied-not-in-code\n` + migrations],
    'migration after exception': [1, head + migrations + `LEDGER_EXCEPTION\t20251231000000_z\t${hex('c')}\tapplied-not-in-code\nMIGRATION\t20260103000000_c\t${hex('d')}\n`],
    'orphan that exists': [1, head + migrations + `LEDGER_EXCEPTION\t20260101000000_a\t${hex('c')}\tapplied-not-in-code\n`],
    'checksum equal to contract': [1, head + migrations + `LEDGER_EXCEPTION\t20260102000000_b\t${hex('b')}\tchecksum-differs\n`],
    'unknown kind': [1, head + migrations + `LEDGER_EXCEPTION\t20260102000000_b\t${hex('c')}\taccepted\n`],
    'extra field': [1, head + migrations + `LEDGER_EXCEPTION\t20260102000000_b\t${hex('c')}\tchecksum-differs\textra\n`],
  }
  for (const [label, [expected, manifest]] of Object.entries(cases)) {
    withRoot((root) => {
      writeFileSync(join(root, 'manifest.tsv'), manifest)
      for (const source of [backup, canary, verifier]) {
        const result = bash(manifestValidator(source) + ' "$MANIFEST"', { MANIFEST: join(root, 'manifest.tsv') })
        assert.equal(result.status === 0 ? 0 : 1, expected, label)
      }
    })
  }
})

test('production ledger shape passes only through exact name and checksum matches', () => {
  const contract = [
    `SCHEMA\tprisma/schema.prisma\t${hex('1')}`,
    `MIGRATION_LOCK\tprisma/migrations/migration_lock.toml\t${hex('2')}`,
    `MIGRATION\t20260101000000_a\t${hex('a')}`,
    `MIGRATION\t20260103000000_c\t${hex('c')}`,
    `MIGRATION\t20260104000000_d\t${hex('d')}`,
    `MIGRATION\t20260105000000_e\t${hex('e')}`,
    `LEDGER_EXCEPTION\t20260102000000_orphan\t${hex('f')}\tapplied-not-in-code`,
    `LEDGER_EXCEPTION\t20260103000000_c\t${hex('9')}\tchecksum-differs`,
    `LEDGER_EXCEPTION\t20260104000000_d\tmanual-20260104000000\tchecksum-differs`,
    '',
  ].join('\n')
  const run = (ledger) => withRoot((root) => {
    writeFileSync(join(root, 'contract.tsv'), contract)
    writeFileSync(join(root, 'ledger.tsv'), ledger)
    const result = bash(exceptionBlock(backup) + 'apply_reviewed_ledger_exceptions "$ROOT/contract.tsv" "$ROOT/ledger.tsv"', { ROOT: root })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  })
  // Production-shaped: an orphan row, a rewritten file and a hand-inserted row.
  assert.equal(
    run(`20260101000000_a\t${hex('a')}\n20260102000000_orphan\t${hex('f')}\n20260103000000_c\t${hex('9')}\n20260104000000_d\tmanual-20260104000000\n`),
    `20260101000000_a\t${hex('a')}\n20260103000000_c\t${hex('c')}\n20260104000000_d\t${hex('d')}\n`,
  )
  // A fresh database already carries repository checksums and is untouched.
  const fresh = `20260101000000_a\t${hex('a')}\n20260103000000_c\t${hex('c')}\n`
  assert.equal(run(fresh), fresh)
  // Same name, other checksum: not reviewed, so it reaches the prefix check unchanged.
  const drift = `20260102000000_orphan\t${hex('0')}\n20260103000000_c\t${hex('8')}\n`
  assert.equal(run(drift), drift)
})
