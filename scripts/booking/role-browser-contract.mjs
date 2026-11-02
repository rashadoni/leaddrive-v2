import assert from 'node:assert/strict';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function sandboxContract(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Hosted Actions required');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Ephemeral hosted runner required');
  assert.equal(env.CI, 'true', 'CI required');
  assert.equal(env.BOOKING_ROLE_SANDBOX, '1', 'Explicit isolated fixture opt-in required');
  assert.notEqual(env.NODE_ENV, 'production', 'Seed harness is never a production process');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'Exact checked revision required');
  assert.match(env.BOOKING_ROLE_HEAD_SHA ?? '', /^[a-f0-9]{40}$/, 'Exact candidate revision required');
  const base = new URL(env.BOOKING_ROLE_BASE_URL);
  assert.equal(base.protocol, 'http:');
  assert.ok(loopback.has(base.hostname), 'Loopback application required');
  assert.equal(base.pathname, '/');
  assert.equal(base.username + base.password + base.search + base.hash, '');
  const database = (raw, role) => {
    const url = new URL(raw);
    assert.equal(url.protocol, 'postgresql:');
    assert.ok(loopback.has(url.hostname), 'Loopback PostgreSQL required');
    assert.equal(url.pathname, '/booking_role_sandbox', 'Dedicated disposable database required');
    assert.equal(url.username, role, 'Exact sandbox role required');
    assert.equal(url.search + url.hash, '', 'No schema or credential override allowed');
    return url;
  };
  const admin = database(env.ADMIN_DATABASE_URL, 'postgres');
  const app = database(env.DATABASE_URL, 'booking_role_sandbox');
  assert.equal(admin.host, app.host, 'Database targets must match');
  assert.equal(env.EVENT_PLATFORM_TEST_DATABASE_URL, admin.href, 'RLS fixture fence must match');
  for (const name of ['AUTH_URL', 'NEXTAUTH_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    assert.equal(new URL(env[name]).origin, base.origin, 'Every application origin must remain loopback');
  }
  return { base, admin, app };
}
