import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { assertOwnMeetingItems, assertConfigurationDenied } from './role-browser-checks.mjs';
import { loadFixtureCrypto } from './role-browser-crypto.mjs';

test('own-filter rejects an assigned singleton, wrong owner, empty or extra rows', () => {
  assertOwnMeetingItems([{ id: 'own', hostUserId: 'coordinator' }], 'own', 'coordinator');
  for (const items of [[], [{ id: 'assigned', hostUserId: 'assigned' }],
    [{ id: 'own', hostUserId: 'assigned' }],
    [{ id: 'own', hostUserId: 'coordinator' }, { id: 'assigned', hostUserId: 'assigned' }]]) {
    assert.throws(() => assertOwnMeetingItems(items, 'own', 'coordinator'));
  }
});

test('admin endpoint denial rejects 200, wrong denial and protected data on 403', () => {
  assertConfigurationDenied(403, { code: 'FORBIDDEN' });
  assert.throws(() => assertConfigurationDenied(200, { code: 'FORBIDDEN' }));
  assert.throws(() => assertConfigurationDenied(403, { code: 'OTHER' }));
  for (const key of ['data', 'pages', 'users', 'grants']) {
    assert.throws(() => assertConfigurationDenied(403, { code: 'FORBIDDEN', [key]: [] }));
  }
});

test('actual crypto fixture helpers wrap keys and reject cross-tenant v2 ciphertext', async () => {
  const previous = process.env.TENANT_PII_MASTER_KEY;
  process.env.TENANT_PII_MASTER_KEY = randomBytes(32).toString('hex');
  const crypto = await loadFixtureCrypto();
  crypto.resetMasterKekCache();
  try {
    for (const orgId of ['sandbox-a', 'sandbox-b']) {
      const key = crypto.generateTenantDataKey();
      const wrapped = crypto.wrapTenantDataKey(orgId, 1, key);
      const opened = crypto.unwrapTenantDataKey(orgId, 1, wrapped.masterKeyId, wrapped.wrappedKey);
      assert.deepEqual(opened, key);
      assert.throws(() => crypto.unwrapTenantDataKey(`${orgId}-wrong`, 1, wrapped.masterKeyId, wrapped.wrappedKey));
      crypto.storeTenantDataKeyRing(orgId, { loadedAt: Date.now(), current: 1,
        keys: new Map([[1, crypto.tenantDataKeyMaterial(orgId, opened)]]) });
      key.fill(0); opened.fill(0);
    }
    const wire = crypto.encryptForTenantBound('sandbox-a', 'fixture', 'phone', '+00000000000');
    assert.match(wire, /^v2:1:/);
    assert.equal(crypto.decryptForTenantBound('sandbox-a', 'fixture', 'phone', wire), '+00000000000');
    assert.throws(() => crypto.decryptForTenantBound('sandbox-b', 'fixture', 'phone', wire));
  } finally {
    crypto.forgetTenantDataKeyRings();
    crypto.resetMasterKekCache();
    if (previous === undefined) delete process.env.TENANT_PII_MASTER_KEY;
    else process.env.TENANT_PII_MASTER_KEY = previous;
  }
});
