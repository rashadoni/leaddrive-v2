import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chownSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bootstrapSql, requiredExtensions, validateClone, verificationSql } from '../../ops/backup/owner-workstation-template.mjs'

const helper = new URL('../../ops/backup/owner-workstation-template.mjs', import.meta.url).pathname
const role = 'owner_restore_verifier'
const catalog = () => ({ versionNumber: 160015, encoding: 'UTF8', provider: 'c', collate: 'C.UTF-8', ctype: 'C.UTF-8',
  icu: null, recordedVersion: null, actualVersion: null, databaseOwnedByVerifier: true, cleanRole: true,
  extensions: Object.entries(requiredExtensions).map(([name, version]) => ({ name, version,
    schema: name === 'plpgsql' ? 'pg_catalog' : 'public', ownedByVerifier: true })) })

test('bootstrap is bounded to fresh template1/PG16/loopback port and one atomic privilege transaction', () => {
  const sql = bootstrapSql('123456789')
  for (const guard of ["current_database()<>'template1'", "current_setting('port')<>'55432'", '123456789',
    'pg_event_trigger', 'pg_auth_members', 'pg_available_extension_versions', 'datistemplate AND datallowconn',
    'DROP EXTENSION plpgsql RESTRICT', 'ALTER DATABASE template1 ALLOW_CONNECTIONS false']) assert(sql.includes(guard), guard)
  assert(sql.startsWith('BEGIN;'))
  assert(sql.indexOf('ALTER ROLE owner_restore_verifier SUPERUSER') > sql.indexOf('OWNER_TEMPLATE_REFUSED'))
  assert(sql.indexOf('ALTER ROLE owner_restore_verifier NOSUPERUSER') < sql.indexOf('COMMIT;'))
  assert(!/\b(?:CASCADE|REASSIGN|ALTER SYSTEM|CREATE ROLE|PASSWORD|5432)\b|UPDATE pg_/.test(sql.replace(/--[^\n]*/g, '')))
  for (const invalid of ['', '0', '-1', '1;DROP DATABASE postgres', 'a'.repeat(40), '123\n', '1'.repeat(21)]) {
    assert.throws(() => bootstrapSql(invalid), /INPUT/)
  }
})

test('clone proof requires exact versions/schema/ownership, locale, role and no extra fields', () => {
  assert.equal(validateClone(catalog()), true)
  const cases = [null, { ...catalog(), endpoint: 'private-host' }, { ...catalog(), versionNumber: 170001 },
    { ...catalog(), encoding: 'SQL_ASCII' }, { ...catalog(), collate: 'C' }, { ...catalog(), ctype: 'en_US.UTF-8' },
    { ...catalog(), provider: 'i' }, { ...catalog(), actualVersion: '2.39' }, { ...catalog(), cleanRole: false },
    { ...catalog(), databaseOwnedByVerifier: false }, { ...catalog(), extensions: catalog().extensions.slice(1) }]
  for (const field of ['version', 'schema', 'ownedByVerifier']) {
    const value = catalog()
    value.extensions[3][field] = field === 'ownedByVerifier' ? false : 'wrong'
    cases.push(value)
  }
  const extra = catalog(); extra.extensions[0].privateName = 'private'; cases.push(extra)
  for (const value of cases) assert.throws(() => validateClone(value), /CLONE_REFUSED/)
  assert(verificationSql.startsWith('BEGIN READ ONLY;'))
  assert(verificationSql.includes('search_path=pg_catalog,pg_temp'))
})

test('CLI prints no unvalidated input/private diagnostics and bounds input', () => {
  for (const input of ['private-password', 'x'.repeat(16385), JSON.stringify({ ...catalog(), password: 'private-password' })]) {
    const result = spawnSync(process.execPath, [helper, '--validate-clone'], { input, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'owner template compatibility refused\n')
  }
  const result = spawnSync(process.execPath, [helper, '--validate-clone'], { input: JSON.stringify(catalog()), encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'owner clone compatibility passed\n')
})

test('image/source are pinned and actual workbench prepares/proves clone before reading private keys', () => {
  const image = readFileSync(new URL('../../ops/backup/owner-workstation.Dockerfile', import.meta.url), 'utf8')
  assert.equal(image.match(/postgres:16\.15-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4/g)?.length, 2)
  for (const pin of ['281d4fcf60e2f037fa09d62be2543bb4d7511f2b', 'e0728ec19cb9d75fcd5a329c48c070b942eb888e6cb83d9e50cc622f6b7d297a', "OPTFLAGS=''", 'with_llvm=no']) assert(image.includes(pin))
  assert(!image.includes('alpine'))
  const source = readFileSync(new URL('../../ops/backup/owner-workstation.sh', import.meta.url), 'utf8')
  const restore = source.slice(source.indexOf('elif [ "$mode" = --self-test ]'))
  assert(restore.indexOf('--validate-clone') < restore.indexOf('for key in identity.agekey owner-evidence'))
  assert(restore.includes('--encoding=UTF8 --locale-provider=libc --lc-collate=C.UTF-8 --lc-ctype=C.UTF-8'))
  assert(restore.includes('"${!PG@}"'))
  assert(source.indexOf('private mounts must be empty') < source.indexOf('mode="${1:-}"'))
})

test('genuine networkless full database restore: vector/comments/RLS/limited role and atomic bootstrap failure', {
  skip: process.env.LEADDRIVE_TEST_OWNER_TEMPLATE === '1' ? false : 'requires fresh hosted networkless Docker PG16+vector; no native services on DEV',
}, () => {
  assert.equal(process.getuid(), 0)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert(existsSync('/.dockerenv'))
  assert(Object.keys(networkInterfaces()).every(name => name === 'lo'))
  assert.equal(readFileSync('/sys/fs/cgroup/memory.swap.max', 'utf8').trim(), '0')
  assert.equal(spawnSync('findmnt', ['-n', '-T', '/database', '-o', 'FSTYPE'], { encoding: 'utf8' }).stdout.trim(), 'tmpfs')
  const root = mkdtempSync('/database/owner-template-'), work = mkdtempSync('/scratch/owner-template-')
  const source = join(root, 'source'), target = join(root, 'target')
  const clean = { PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C' }
  const command = (program, args, extra = {}) => spawnSync(program, args, {
    env: clean, encoding: 'utf8', timeout: 30000, maxBuffer: 131072, ...extra,
  })
  const ok = (result, label = 'public synthetic command') => assert.equal(result.status, 0, label + ': ' + result.stderr + result.stdout)
  const uid = Number(command('id', ['-u', 'postgres']).stdout.trim())
  const gid = Number(command('id', ['-g', 'postgres']).stdout.trim())
  assert(uid > 0 && gid > 0)
  chownSync(root, uid, gid)
  const admin = (data, port, database, sql) => command('gosu', ['postgres', 'psql', '-X', '-qAt', '-w', '-h', data,
    '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: sql })
  const started = []
  try {
    for (const [data, port] of [[source, 55431], [target, 55432]]) {
      ok(command('gosu', ['postgres', 'initdb', '-D', data, '-A', 'trust', '-U', 'postgres',
        '--encoding=UTF8', '--locale-provider=libc', '--lc-collate=C.UTF-8', '--lc-ctype=C.UTF-8', '--no-instructions']))
      writeFileSync(join(data, 'pg_hba.conf'), 'local all all trust\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all ::1/128 reject\n', { mode: 0o600 })
      chownSync(join(data, 'pg_hba.conf'), uid, gid)
      ok(command('gosu', ['postgres', 'pg_ctl', '-D', data, '-l', join(data, 'server.log'),
        '-o', '-h 127.0.0.1 -p ' + port + ' -k ' + data, '-w', 'start']))
      started.push(data)
    }
    ok(admin(source, 55431, 'postgres', `CREATE EXTENSION vector VERSION '0.6.0';
CREATE EXTENSION pgcrypto VERSION '1.3'; CREATE EXTENSION btree_gist VERSION '1.7';
COMMENT ON EXTENSION vector IS 'public synthetic vector comment';
CREATE TABLE fixture_items(id int PRIMARY KEY, tenant_id text NOT NULL, label text NOT NULL, embedding vector(3));
INSERT INTO fixture_items VALUES (1,'alpha','Əlifba',ARRAY[1,2,3]::vector),(2,'beta','Пример',ARRAY[4,5,6]::vector);
CREATE INDEX fixture_vector_index ON fixture_items USING hnsw(embedding vector_l2_ops);
ALTER TABLE fixture_items ENABLE ROW LEVEL SECURITY; ALTER TABLE fixture_items FORCE ROW LEVEL SECURITY;
CREATE POLICY fixture_tenant ON fixture_items USING (tenant_id=current_setting('app.org_id',true));
CREATE TABLE fixture_intervals(tenant int, period int4range, EXCLUDE USING gist(tenant WITH =,period WITH &&));
INSERT INTO fixture_intervals VALUES (1,int4range(1,3));
CREATE FUNCTION fixture_echo(text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN $1; END $$;
`))
    const sourceProofSql = "SELECT (pg_control_system()).system_identifier,pg_postmaster_start_time(); SELECT id,label,embedding FROM fixture_items ORDER BY id; SELECT extname,extversion,extowner FROM pg_extension ORDER BY extname;"
    const before = admin(source, 55431, 'postgres', sourceProofSql); ok(before)
    const sourceId = admin(source, 55431, 'postgres', 'SELECT (pg_control_system()).system_identifier::text').stdout.trim()
    const targetId = admin(target, 55432, 'postgres', 'SELECT (pg_control_system()).system_identifier::text').stdout.trim()
    assert.notEqual(targetId, sourceId)
    const sourceHba = readFileSync(join(source, 'pg_hba.conf'))
    ok(admin(target, 55432, 'postgres', `CREATE ROLE ${role} LOGIN NOSUPERUSER NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'public-synthetic-only'; CREATE DATABASE fixture_outsider;`))
    const password = join(work, 'verifier.pgpass')
    writeFileSync(password, `127.0.0.1:55432:*:${role}:public-synthetic-only\n`, { mode: 0o600 })
    const passwordBefore = readFileSync(password)
    const connection = { ...clean, PGHOST: '127.0.0.1', PGHOSTADDR: '127.0.0.1', PGPORT: '55432', PGUSER: role,
      PGPASSFILE: password, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' }
    const query = (database, sql) => command('psql', ['-X', '-qAt', '-w', '-d', database, '-v', 'ON_ERROR_STOP=1'], { env: connection, input: sql })
    const create = database => command('createdb', ['-w', '--maintenance-db=postgres', database], { env: connection })
    const drop = database => command('dropdb', ['-w', '--maintenance-db=postgres', database], { env: connection })
    const dump = join(work, 'full.dump')
    // Root client owns /scratch and its private file. The public synthetic
    // source uses its explicitly fresh local trust HBA; do not open the RAM
    // mount to another OS identity just to write this test dump.
    ok(command('pg_dump', ['-h', source, '-p', '55431', '-U', 'postgres', '-d', 'postgres', '-Fc', '-f', dump]))
    const restore = database => command('pg_restore', ['-w', '--exit-on-error', '--no-owner', '--no-privileges', '--dbname=' + database, dump], { env: connection })
    ok(create('fixture_unprepared'))
    const denied = restore('fixture_unprepared')
    assert.notEqual(denied.status, 0, 'plain template must not falsely pass the full vector restore')
    assert.match(denied.stderr, /permission denied to create extension|must be superuser/i)
    ok(drop('fixture_unprepared'))
    // Failure injection in a public synthetic transaction, NOT a production
    // bootstrap option or a claim that an altered script is the normal path.
    const failedSql = bootstrapSql(targetId).replace("CREATE EXTENSION vector WITH SCHEMA public VERSION '0.6.0';", 'SELECT 1/0;')
    assert.notEqual(admin(target, 55432, 'template1', failedSql).status, 0)
    assert.equal(admin(target, 55432, 'postgres', `SELECT rolsuper::int FROM pg_roles WHERE rolname='${role}'`).stdout.trim(), '0')
    assert.equal(admin(target, 55432, 'template1', 'SELECT extname FROM pg_extension ORDER BY extname').stdout.trim(), 'plpgsql')
    // The unmodified actual bootstrap must refuse the real SOURCE endpoint.
    assert.notEqual(admin(source, 55431, 'template1', bootstrapSql(sourceId)).status, 0)
    ok(admin(target, 55432, 'template1', bootstrapSql(targetId)), 'actual unmodified bootstrap')
    assert.equal(admin(target, 55432, 'postgres', "SELECT datallowconn::int FROM pg_database WHERE datname='template1'").stdout.trim(), '0')
    ok(create('fixture_restored'))
    const proof = query('fixture_restored', verificationSql); ok(proof)
    assert.equal(validateClone(JSON.parse(proof.stdout)), true)
    ok(restore('fixture_restored'), 'FULL database limited-role restore, no TOC filtering/ignored errors')
    const afterRestore = query('fixture_restored', verificationSql); ok(afterRestore)
    assert.equal(validateClone(JSON.parse(afterRestore.stdout)), true)
    assert.equal(query('fixture_restored', "SELECT fixture_echo('works'),encode(digest('public','sha256'),'hex') IS NOT NULL; SELECT count(*) FROM fixture_intervals;").stdout.trim(), 'works|t\n1')
    assert.equal(query('fixture_restored', "SET app.org_id='alpha'; SELECT id,label,embedding FROM fixture_items ORDER BY id;").stdout.trim(), '1|Əlifba|[1,2,3]')
    assert.equal(query('fixture_restored', "SET app.org_id='beta'; SELECT id,label,embedding FROM fixture_items ORDER BY id;").stdout.trim(), '2|Пример|[4,5,6]')
    assert.equal(query('fixture_restored', 'SELECT count(*) FROM fixture_items').stdout.trim(), '0', 'tenant isolation survives restore')
    assert.equal(query('fixture_restored', "SELECT obj_description(oid,'pg_extension') FROM pg_extension WHERE extname='vector'").stdout.trim(), 'public synthetic vector comment')
    ok(drop('fixture_restored'))
    assert.equal(query('postgres', "SELECT count(*) FROM pg_database WHERE datname IN ('fixture_restored','fixture_unprepared')").stdout.trim(), '0')
    assert.equal(admin(target, 55432, 'postgres', "SELECT count(*) FROM pg_database WHERE datname='fixture_outsider'").stdout.trim(), '1')
    assert.equal(admin(source, 55431, 'postgres', sourceProofSql).stdout, before.stdout, 'source identity/start/data/extensions unchanged')
    assert.deepEqual(readFileSync(join(source, 'pg_hba.conf')), sourceHba)
    assert.deepEqual(readFileSync(password), passwordBefore)
  } finally {
    for (const data of started.reverse()) ok(command('gosu', ['postgres', 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop']))
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})
