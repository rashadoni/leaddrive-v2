import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boundedFile, catalogSql, inspect, parseConfiguration, queryPlan, summarizeCatalog, validateEnvelope, validateOutput } from './inspect-backup-compatibility.mjs'

const sha = 'a'.repeat(40)
const raw = () => ({ versionNumber: 160015, encoding: 'UTF8', provider: 'c', collate: 'C.UTF-8', ctype: 'C.UTF-8', icu: null,
  recordedVersion: null, actualVersion: null, tls: true, extensions: [
    { name: 'vector', version: '0.6.0', schema: 'public' }, { name: 'pgcrypto', version: '1.3', schema: 'public' },
    { name: 'plpgsql', version: '1.0', schema: 'pg_catalog' },
  ] })
const configuration = () => Buffer.from('PGHOST=public-fixture-source\nPGHOSTADDR=127.0.0.2\nPGPORT=55431\nPGDATABASE=fixture_db\nPGUSER=fixture_source\nPGPASSFILE=/etc/leaddrive/backup.pgpass\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\nPGCONNECT_TIMEOUT=2\nBACKUP_EXPECTED_DB_ROLE=fixture_source\nAWS_SECRET_ACCESS_KEY=must-not-leave\nPGPASSWORD=must-not-be-inherited\n')
const control = () => ({ control: 'present', defaultVersion: '0.8.0', sourceVersionSql: 'missing' })
const clone = object => JSON.parse(JSON.stringify(object))
const helper = new URL('./inspect-backup-compatibility.mjs', import.meta.url).pathname
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'backup-catalog-metadata-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('strict source catalog reports versions without claiming scratch compatibility', () => {
  const report = summarizeCatalog(raw(), control)
  assert.equal(report.source.major, 16)
  assert.equal(report.source.locale.versionMatches, true)
  assert.equal(report.source.locale.collate, 'C.UTF-8')
  assert.equal(report.scratchDatabaseCompatibility, 'not-inspected')
  assert.deepEqual(report.source.extensions.map(e => e.name), ['pgcrypto', 'plpgsql', 'vector'])
  assert.equal(report.hostExtensionFiles.find(e => e.name === 'vector').sourceVersionSql, 'missing')
  assert.equal(report.hostExtensionFiles.find(e => e.name === 'vector').defaultVersion, '0.8.0')
  assert.equal(validateOutput(clone(report)).status, 'inspected')
})

test('unknown extension/schema/custom locale identifiers never leave even through error output', () => {
  const catalog = raw()
  catalog.extensions.push({ name: 'private_org_extension', version: '1.2', schema: 'customer_private_schema' })
  catalog.extensions[0].schema = 'customer_private_schema'
  catalog.collate = 'private-customer-locale'
  catalog.ctype = 'private-customer-locale'
  catalog.icu = 'private-customer-icu'
  catalog.actualVersion = 'private-customer-version'
  const output = JSON.stringify(summarizeCatalog(catalog, control))
  for (const privateValue of ['private_org_extension', 'customer_private_schema', 'private-customer-locale', 'private-customer-icu', 'private-customer-version']) assert(!output.includes(privateValue))
  const report = JSON.parse(output)
  assert.equal(report.source.unknownExtensionCount, 1)
  assert.equal(report.source.locale.collate, 'other')
  assert.equal(report.source.locale.actualVersion, 'other')
  assert.equal(report.source.locale.versionMatches, false)
})

test('malformed source, wrong major, TLS absence, duplicates and oversized catalogs refuse', () => {
  const cases = [null, [], { ...raw(), password: 'never-export' }, { ...raw(), versionNumber: 170001 },
    { ...raw(), tls: false }, { ...raw(), collate: '../never-export' .repeat(30) },
    { ...raw(), extensions: [...raw().extensions, raw().extensions[0]] },
    { ...raw(), extensions: [{ name: '../private', version: '1.0', schema: 'public' }] },
    { ...raw(), extensions: [{ name: 'vector', version: '../private', schema: 'public' }] },
    { ...raw(), extensions: Array.from({ length: 33 }, (_, i) => ({ name: 'x' + i, version: '1.0', schema: 'public' })) }]
  for (const value of cases) assert.throws(() => summarizeCatalog(value, control), /SOURCE_METADATA/)
})

test('strict second output gate rejects extra fields, identifiers, fake readiness and inconsistent controls', () => {
  const report = summarizeCatalog(raw(), control)
  const cases = []
  let value = clone(report); value.ready = true; cases.push(value)
  value = clone(report); value.source.hostname = 'private-host'; cases.push(value)
  value = clone(report); value.source.extensions[0].name = 'private-extension'; cases.push(value)
  value = clone(report); value.source.locale.collate = 'private-company-locale'; cases.push(value)
  value = clone(report); value.source.locale.provider = 'private-vendor'; cases.push(value)
  value = clone(report); value.hostExtensionFiles[0].path = '/private'; cases.push(value)
  value = clone(report); value.hostExtensionFiles[0].defaultVersion = null; cases.push(value)
  value = clone(report); value.scratchDatabaseCompatibility = 'verified'; cases.push(value)
  for (const bad of cases) assert.throws(() => validateOutput(bad), /OUTPUT/)
})

test('configuration is parsed as data, never sourced; credentials/services/parent environment are not inherited', () => {
  const config = parseConfiguration(configuration())
  assert(!Object.hasOwn(config, 'AWS_SECRET_ACCESS_KEY'))
  assert(!Object.hasOwn(config, 'PGPASSWORD'))
  const plan = queryPlan(config)
  assert.equal(plan.executable, '/usr/bin/timeout')
  assert(plan.args.includes('--kill-after=5'))
  assert(plan.args.includes('/usr/sbin/runuser'))
  assert(plan.args.includes('leaddrive-backup'))
  assert.equal(plan.args.at(-1), catalogSql)
  for (const value of ['public-fixture-source', '127.0.0.2', 'fixture_db', 'fixture_source', 'must-not-leave', 'env']) assert(!plan.args.includes(value), value)
  assert.equal(plan.options.env.PGSSLMODE, 'verify-full')
  assert.equal(plan.options.env.PGOPTIONS, '-c default_transaction_read_only=on -c statement_timeout=10000')
  assert.equal(plan.options.timeout, 42000)
  assert.equal(plan.options.maxBuffer, 16384)
  assert.equal(plan.options.env.PGPASSWORD, undefined)
  assert.equal(plan.options.env.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(plan.options.env.PGSERVICE, undefined)
  for (const bytes of [Buffer.concat([configuration(), Buffer.from('PGHOST=duplicate\n')]),
    Buffer.from(configuration().toString().replace('verify-full', 'require')),
    Buffer.from(configuration().toString().replace('PGDATABASE=fixture_db', 'PGDATABASE=postgres://private')),
    Buffer.from(configuration().toString().replace('PGHOST=public-fixture-source', 'PGHOST=$(never-run)')),
    Buffer.from(configuration().toString().replace('PGPORT=55431', 'PGPORT=55432')),
    Buffer.from(configuration().toString().replace('PGCONNECT_TIMEOUT=2', 'PGCONNECT_TIMEOUT=99')),
    Buffer.from(configuration().toString().replace('PGHOSTADDR=127.0.0.2', 'PGHOSTADDR=not-numeric')),
    Buffer.from('x'.repeat(65537))]) assert.throws(() => parseConfiguration(bytes), /CONFIGURATION/)
})

test('bounded authority refuses symlinks, hardlinks, unsafe modes, wrong owner and oversized files', () => fixture(root => {
  const path = join(root, 'public-config')
  writeFileSync(path, 'public fixture', { mode: 0o600 })
  assert.equal(boundedFile(path, 100, process.getuid(), [0o600]).toString(), 'public fixture')
  assert.throws(() => boundedFile(path, 1, process.getuid(), [0o600]), /AUTHORITY/)
  assert.throws(() => boundedFile(path, 100, process.getuid() + 1, [0o600]), /AUTHORITY/)
  symlinkSync(path, join(root, 'alias'))
  assert.throws(() => boundedFile(join(root, 'alias'), 100, process.getuid(), [0o600]), /AUTHORITY/)
  chmodSync(path, 0o666)
  assert.throws(() => boundedFile(path, 100, process.getuid(), [0o600]), /AUTHORITY/)
  chmodSync(path, 0o600); linkSync(path, join(root, 'hardlink'))
  assert.throws(() => boundedFile(path, 100, process.getuid(), [0o600]), /AUTHORITY/)
}))

test('non-root, artifact drift and bad config refuse before any SQL; child diagnostics never export', () => {
  const files = new Map([['/opt/leaddrive-v2/.next/standalone/.deploy-sha', Buffer.from(sha + '\n')], ['/etc/leaddrive/backup.env', configuration()]])
  let current, calls = 0
  const io = { realpathSync: path => path, openSync: path => { current = files.get(path); return 1 },
    fstatSync: () => ({ isFile: () => true, uid: 0, nlink: 1, mode: 0o600, size: current.length }),
    readFileSync: () => current, closeSync: () => {} }
  const runtime = { io, uid: () => 0, spawn: () => { calls++; return { status: 1, stderr: 'private-server-password-diagnostic', stdout: '' } } }
  assert.throws(() => inspect(sha, { ...runtime, uid: () => 1000 }), /INPUT/)
  assert.equal(calls, 0)
  assert.throws(() => inspect('b'.repeat(40), runtime), /ARTIFACT/)
  assert.equal(calls, 0)
  files.set('/etc/leaddrive/backup.env', Buffer.from('PGHOST=$(private-command)\n'))
  assert.throws(() => inspect(sha, runtime), /CONFIGURATION/)
  assert.equal(calls, 0)
  files.set('/etc/leaddrive/backup.env', configuration())
  assert.throws(() => inspect(sha, runtime), /SOURCE_QUERY/)
  assert.equal(calls, 1)
})

test('CLI second gate bounds stdin and prints no unvalidated private payload', () => {
  for (const input of ['private-credential-value', JSON.stringify({ ...summarizeCatalog(raw(), control), password: 'private-credential-value' }), 'x'.repeat(16385)]) {
    const result = spawnSync(process.execPath, [helper, '--validate-output'], { input, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert(!result.stderr.includes('private-credential-value'))
    assert.equal(JSON.parse(result.stderr).status, 'refused')
  }
  const valid = summarizeCatalog(raw(), control)
  const result = spawnSync(process.execPath, [helper, '--validate-output'], { input: JSON.stringify(valid), encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), valid)
  const refusal = { format: 1, status: 'refused', stage: 'SOURCE_QUERY' }
  assert.deepEqual(validateEnvelope(refusal), refusal)
  assert.throws(() => validateEnvelope({ ...refusal, password: 'private' }), /OUTPUT/)
  const safeFailure = spawnSync(process.execPath, [helper, '--inspect', 'not-a-sha'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(safeFailure.status, 1)
  assert.deepEqual(JSON.parse(safeFailure.stdout), { format: 1, status: 'refused', stage: 'INPUT' })
  const gate = spawnSync(process.execPath, [helper, '--validate-output'], { input: safeFailure.stdout, encoding: 'utf8', timeout: 5000 })
  assert.equal(gate.status, 0)
  assert.equal(JSON.parse(gate.stdout).stage, 'INPUT')
})

test('SQL is fixed catalog-only and workflow uses protected main plus a second output gate', () => {
  assert.match(catalogSql, /pg_extension/)
  assert.match(catalogSql, /pg_database_collation_actual_version/)
  assert(!/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|COPY)\b/i.test(catalogSql))
  assert(!/public\.|users|organizations|PGPASSWORD/i.test(catalogSql))
  const workflow = readFileSync(new URL('../workflows/tail-app-logs.yml', import.meta.url), 'utf8')
  assert(workflow.includes('- backup-compatibility'))
  assert(workflow.includes('node --test .github/scripts/test-inspect-backup-compatibility.mjs'))
  assert(workflow.includes('inspect-backup-compatibility.mjs --validate-output'))
  assert(workflow.includes('assert-production-environment-protection'))
  assert(!workflow.includes('pull_request_target'))
})
