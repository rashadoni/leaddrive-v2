import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { emitRemote, sanitize } from './inspect-production.mjs';

const sourceSha = 'a'.repeat(40), artifactSha = 'b'.repeat(40);
const inventory = () => ({ bookingCount: 2, invalidHostCount: 0, invalidPageCount: 0,
  duplicateTaskCount: 0, overlapCount: 0, invalidIntervalCount: 0, missingTaskCount: 1,
  missingLeadCount: 1, invalidTaskLinkCount: 1, invalidLeadLinkCount: 1,
  btreeGistAvailable: true, btreeGistInstalled: false, extensionCreatePrivilege: true,
  migrationRoleSuperuser: false, rlsUnfiltered: true, readOnly: true });
const validate = (value, exit = 0) => sanitize(JSON.stringify(value), sourceSha, artifactSha, exit);

test('successful inventory binds both revisions without approving a release or repairing legacy links', () => {
  const result = validate(inventory());
  assert.equal(result.status, 'PASS_INVENTORY_ONLY');
  assert.equal(result.sourceSha, sourceSha);
  assert.equal(result.artifactSha, artifactSha);
  assert.equal(result.productionObserved, true);
  assert.equal(result.inventory.invalidTaskLinkCount, 1);
});

test('each constraint conflict blocks admission; extension prerequisites cannot be assumed', () => {
  for (const key of ['invalidHostCount','invalidPageCount','duplicateTaskCount','overlapCount','invalidIntervalCount']) {
    assert.equal(validate({ ...inventory(), [key]: 1 }).status, 'BLOCKED_DATA_OR_EXTENSION');
  }
  assert.equal(validate({ ...inventory(), btreeGistAvailable: false }).status, 'BLOCKED_DATA_OR_EXTENSION');
  assert.equal(validate({ ...inventory(), extensionCreatePrivilege: false }).status, 'BLOCKED_DATA_OR_EXTENSION');
  assert.equal(validate({ ...inventory(), extensionCreatePrivilege: false, btreeGistInstalled: true }).status, 'PASS_INVENTORY_ONLY');
});

test('transport errors, incomplete responses and possible payloads leave only a finite failure', () => {
  for (const raw of ['permission denied SECRET', '{"email":"PRIVATE"}', 'null', '[]', '{}', 'x'.repeat(4097), JSON.stringify({...inventory(), email:'PRIVATE'})]) {
    const result = sanitize(raw, sourceSha, artifactSha, 0);
    assert.equal(result.status, 'ERROR');
    assert.equal(result.productionObserved, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|email/);
  }
  assert.equal(validate(inventory(), 255).status, 'ERROR');
});

test('counts, booleans and read-only evidence are strictly typed', () => {
  for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
    assert.equal(validate({...inventory(), bookingCount: value}).status, 'ERROR');
  }
  assert.equal(validate({...inventory(), readOnly: false}).status, 'ERROR');
  assert.equal(validate({...inventory(), rlsUnfiltered: false}).status, 'ERROR');
  assert.equal(validate({...inventory(), btreeGistInstalled: 'true'}).status, 'ERROR');
});

test('malformed revisions never become remote shell instructions', () => {
  for (const sha of ['', 'main', 'A'.repeat(40), "'$(touch /tmp/unsafe)", sourceSha+'\n']) {
    assert.throws(() => emitRemote(sha));
    assert.throws(() => sanitize('{}', sourceSha, sha, 0));
  }
});

test('emitted script parses and uses only the bounded read-only helper and exact artifact check', () => {
  const script = emitRemote(artifactSha);
  assert.equal(spawnSync('bash', ['-n'], { input: script }).status, 0);
  assert.match(script, /default_transaction_read_only=on/);
  assert.match(script, /statement_timeout=30s -c lock_timeout=3s/);
  assert.match(script, /timeout 45 python3/);
  assert.match(script, new RegExp(`= '${artifactSha}'`));
  assert.doesNotMatch(script, /^\s*(?:inspect_production\(\)|report_connection_file_metadata\(\)|eval |source )/m);
});

test('CLI suppresses malformed input and does not preserve SQL stderr', () => {
  const cli = new URL('./inspect-production.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, '--validate-output', sourceSha, artifactSha, '255'], { input: 'PRIVATE_SQL_ERROR', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, 'ERROR');
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SQL_ERROR/);
});

const dbUrl = process.env.BOOKING_PREFLIGHT_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !dbUrl) throw new Error('BOOKING_PREFLIGHT_TEST_DATABASE_URL_REQUIRED');
test('actual SQL against isolated Postgres: conflicts, missing projections and write rejection', {skip: !dbUrl}, () => {
  const parsed = new URL(dbUrl);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname), 'fixture accepts only owned loopback PostgreSQL');
  const env = {...process.env, PGDATABASE: dbUrl, PGOPTIONS: '-c statement_timeout=10s -c lock_timeout=2s'};
  const psql = sql => spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, env, encoding: 'utf8', timeout: 20000 });
  // This database is owned exclusively by the disposable service in this workflow.
  const setup = psql(`CREATE TABLE users(id text, "organizationId" text);
CREATE TABLE booking_pages(id text, "organizationId" text);
CREATE TABLE tasks(id text, "organizationId" text);
CREATE TABLE leads(id text, "organizationId" text);
CREATE TABLE bookings(id text, "organizationId" text, "hostUserId" text, "bookingPageId" text,
"taskId" text, "leadId" text, "startsAt" timestamp, "endsAt" timestamp, status text);
INSERT INTO users VALUES ('host','org'); INSERT INTO booking_pages VALUES ('page','org');
INSERT INTO bookings VALUES ('a','org','host','page',NULL,NULL,'2026-10-24 09:00','2026-10-24 10:00','confirmed');`);
  assert.equal(setup.status, 0, 'isolated fixture creation');
  const sql = readFileSync(new URL('./inspect-production.sql', import.meta.url), 'utf8');
  const initial = psql(sql);
  assert.equal(initial.status, 0, 'actual production SQL executes');
  const first = JSON.parse(initial.stdout);
  assert.equal(first.bookingCount, 1); assert.equal(first.missingTaskCount, 1);
  assert.equal(first.overlapCount, 0); assert.equal(first.readOnly, true);
  assert.equal(validate(first).status, 'PASS_INVENTORY_ONLY');
  assert.equal(psql(`INSERT INTO bookings VALUES
('b','org','host','page','task','lead','2026-10-24 09:30','2026-10-24 10:30','confirmed'),
('c','other','host','page','task','lead','2026-10-24 11:00','2026-10-24 10:00','confirmed'),
('d','org','host','page','task',NULL,'2026-10-25 09:00','2026-10-25 10:00','confirmed');`).status, 0);
  const conflicts = JSON.parse(psql(sql).stdout);
  assert.equal(conflicts.overlapCount, 1); assert.equal(conflicts.invalidHostCount, 1);
  assert.equal(conflicts.invalidPageCount, 1); assert.equal(conflicts.invalidIntervalCount, 1);
  assert.equal(conflicts.duplicateTaskCount, 1); assert.equal(conflicts.invalidTaskLinkCount, 3);
  assert.equal(conflicts.invalidLeadLinkCount, 2);
  assert.equal(validate(conflicts).status, 'BLOCKED_DATA_OR_EXTENSION');
  const write = psql("BEGIN READ ONLY; INSERT INTO users VALUES ('forbidden','org'); COMMIT;");
  assert.notEqual(write.status, 0); assert.match(write.stderr, /read-only transaction/);
  assert.equal(psql("SELECT count(*) FROM users WHERE id='forbidden'").stdout.trim(), '0');
});
