import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { emitEffectsRemote, sanitizeEffects } from './inspect-effects.mjs';

const sha = 'a'.repeat(40), artifact = 'b'.repeat(40), booking = 'c' + 'a'.repeat(24);
const stamp = '2026-10-25T17:00:00.000Z';
const row = () => ({ id: '11111111-1111-1111-1111-111111111111', status: 'pending', attemptCount: 0,
  bookingVersion: 1, lastErrorCode: 'LOCAL_FAILURE_20', availableAtUTC: stamp, createdAtUTC: stamp, completedAtUTC: null });
const metadata = () => ({ bookingFound: true, truncated: false, observedUTC: stamp,
  sessionTimezone: 'Asia/Baku', readOnly: true, rlsUnfiltered: true, rows: [row()] });
const validate = value => sanitizeEffects(JSON.stringify(value), sha, artifact, 0);

test('pending is reported honestly, with both SHA bindings and UTC row metadata', () => {
  const result = validate(metadata());
  assert.equal(result.status, 'PASS_EFFECT_METADATA_ONLY');
  assert.equal(result.sourceSha, sha); assert.equal(result.artifactSha, artifact);
  assert.equal(result.metadata.rows[0].status, 'pending');
  assert.equal(result.metadata.rows[0].lastErrorCode, 'LOCAL_FAILURE_20');
  assert.equal(validate({ ...metadata(), bookingFound: false, rows: [] }).metadata.bookingFound, false);
});

test('untrusted output, arbitrary fields/errors, duplicate rows and invalid scalar values fail closed', () => {
  for (const raw of ['PRIVATE_SQL_ERROR', 'null', '[]', '{}', 'x'.repeat(16385), JSON.stringify({ ...metadata(), payload: 'PRIVATE' })]) {
    const result = sanitizeEffects(raw, sha, artifact, 0);
    assert.equal(result.status, 'ERROR'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|payload/);
  }
  for (const value of [
    { ...metadata(), readOnly: false }, { ...metadata(), rlsUnfiltered: false }, { ...metadata(), truncated: true },
    { ...metadata(), bookingFound: false }, { ...metadata(), observedUTC: 'not-time' },
    { ...metadata(), rows: [row(), row()] }, { ...metadata(), sessionTimezone: 'PRIVATE\n' },
    ...[{ payload: 'PRIVATE' }, { status: 'unknown' }, { attemptCount: -1 }, { bookingVersion: 1.2 },
      { lastErrorCode: 'PRIVATE_PROVIDER_ERROR' }, { availableAtUTC: 'infinity' }, { completedAtUTC: 3 }]
      .map(change => ({ ...metadata(), rows: [{ ...row(), ...change }] })),
  ]) assert.equal(validate(value).status, 'ERROR');
  assert.equal(sanitizeEffects(JSON.stringify(metadata()), sha, artifact, 255).status, 'ERROR');
});

test('selectors cannot inject SQL or shell, and emitted runner retains read-only credentials-safe guards', () => {
  for (const bad of ['', "';select secret;--", 'x'.repeat(61), 'abc\n', '$(touch /tmp/unsafe)']) {
    assert.throws(() => emitEffectsRemote(artifact, bad, booking));
    assert.throws(() => emitEffectsRemote(artifact, 'test-tenant', bad));
  }
  assert.throws(() => emitEffectsRemote('main', 'test-tenant', booking));
  const script = emitEffectsRemote(artifact, 'test-tenant', booking);
  assert.equal(spawnSync('bash', ['-n'], { input: script }).status, 0);
  assert.match(script, /BEGIN READ ONLY/); assert.match(script, /default_transaction_read_only=on/);
  assert.match(script, /statement_timeout=30s -c lock_timeout=3s/);
  assert.match(script, /LIMIT 21/); assert.match(script, /o\.slug = 'test-tenant'/);
  assert.match(script, new RegExp(`b.id = '${booking}'`));
  assert.doesNotMatch(script, /EFFECT_DIAGNOSTIC_|(?:INSERT INTO|UPDATE public|DELETE FROM)|^\s*(?:eval |source )/m);
  const sql = readFileSync(new URL('./inspect-effects.sql', import.meta.url), 'utf8')
    .replace('EFFECT_DIAGNOSTIC_TENANT', 'test-tenant').replace('EFFECT_DIAGNOSTIC_BOOKING', booking);
  assert.ok(script.includes(sql), 'emitted SQL retains literal regex anchors and quoted heredoc');
});

test('workflow keeps PRs away from production and validates/quotes all selectors', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/booking-release-preflight.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node --test scripts\/booking\/inspect-effects.test.mjs/);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /remote_args\+=\("\$BOOKING_EFFECT_TENANT" "\$BOOKING_EFFECT_ID"\)/);
  assert.match(workflow, /node "\$inspector" "\$\{remote_args\[@\]\}"/);
  assert.match(workflow, /uses: .\/.github\/actions\/assert-production-environment-protection/);
});

test('CLI never echoes malformed input or private SQL failures', () => {
  const cli = new URL('./inspect-effects.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, '--validate-output', sha, artifact, '255'], { input: 'PRIVATE_SQL_ERROR', encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'ERROR');
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SQL_ERROR/);
});

const dbUrl = process.env.BOOKING_PREFLIGHT_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !dbUrl) throw Error('BOOKING_PREFLIGHT_TEST_DATABASE_URL_REQUIRED');
test('actual PostgreSQL isolates tenant/booking/type/mode, redacts errors, bounds rows and forbids writes', { skip: !dbUrl }, () => {
  const parsed = new URL(dbUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  Object.assign(env, { PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10s -c lock_timeout=2s' });
  const query = (sql, fixture = false) => spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, env: fixture ? { ...env, PGOPTIONS: '-c statement_timeout=10s -c lock_timeout=2s' } : env, encoding: 'utf8', timeout: 20000 });
  const setup = query(`CREATE TABLE IF NOT EXISTS organizations(id text,slug text);
    CREATE TABLE IF NOT EXISTS bookings(id text,"organizationId" text);
    CREATE TABLE effect_outbox(id uuid,"organizationId" text,"effectType" text,"executionMode" text,payload jsonb,
      status text,"attemptCount" integer,"lastError" text,"availableAt" timestamp,"createdAt" timestamp,"completedAt" timestamp);
    INSERT INTO organizations VALUES('effects-org','test-tenant'),('foreign-org','foreign');
    INSERT INTO bookings(id,"organizationId") VALUES('${booking}','effects-org');
    INSERT INTO effect_outbox SELECT md5(i::text)::uuid,'effects-org','booking.project','live',
      jsonb_build_object('bookingId','${booking}','version',i,'private','PRIVATE_PAYLOAD'), 'pending',0,
      CASE WHEN i=1 THEN 'LOCAL_FAILURE_20' ELSE 'PRIVATE_ERROR' END,'2026-10-25 17:00','2026-10-25 16:00',NULL
      FROM generate_series(1,2) i;
    INSERT INTO effect_outbox SELECT md5((100+i)::text)::uuid,
      CASE WHEN i=1 THEN 'foreign-org' ELSE 'effects-org' END,
      CASE WHEN i=2 THEN 'booking.host-email' ELSE 'booking.project' END,
      CASE WHEN i=3 THEN 'shadow' ELSE 'live' END,
      jsonb_build_object('bookingId',CASE WHEN i=4 THEN 'different-booking' ELSE '${booking}' END,'version',1),
      'pending',0,'PRIVATE_FOREIGN','2026-10-25 17:00','2026-10-25 16:00',NULL FROM generate_series(1,4) i;`, true);
  assert.equal(setup.status, 0, 'create exclusively disposable fixtures');
  const sql = readFileSync(new URL('./inspect-effects.sql', import.meta.url), 'utf8')
    .replace('EFFECT_DIAGNOSTIC_TENANT', 'test-tenant').replace('EFFECT_DIAGNOSTIC_BOOKING', booking);
  const read = zone => { const result = query(`SET TIME ZONE '${zone}';\n${sql}`);
    assert.equal(result.status, 0, 'actual readonly SQL executes'); return JSON.parse(result.stdout); };
  for (const zone of ['UTC', 'Asia/Baku', 'America/New_York']) {
    const value = read(zone);
    assert.equal(value.rows.length, 2); assert.equal(value.sessionTimezone, zone);
    assert.equal(value.rows[0].availableAtUTC, stamp);
    assert.deepEqual(new Set(value.rows.map(r => r.lastErrorCode)), new Set(['LOCAL_FAILURE_20', 'REDACTED']));
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE|payload|foreign-org/);
    assert.equal(validate(value).status, 'PASS_EFFECT_METADATA_ONLY');
  }
  const missing = query(sql.replace("o.slug = 'test-tenant'", "o.slug = 'missing'"));
  assert.equal(missing.status, 0); assert.deepEqual(JSON.parse(missing.stdout).rows, []);
  assert.equal(JSON.parse(missing.stdout).bookingFound, false);
  assert.notEqual(query("BEGIN READ ONLY; DELETE FROM effect_outbox;").status, 0);
  assert.equal(query('SELECT count(*) FROM effect_outbox;').stdout.trim(), '6');
  assert.equal(query(`INSERT INTO effect_outbox SELECT md5((200+i)::text)::uuid,'effects-org','booking.project','live',
    jsonb_build_object('bookingId','${booking}','version',i),'pending',0,NULL,now(),now(),NULL FROM generate_series(1,20) i;`, true).status, 0);
  const bounded = read('UTC'); assert.equal(bounded.rows.length, 20); assert.equal(bounded.truncated, true);
  assert.equal(validate(bounded).status, 'ERROR');
});
