import assert from 'node:assert/strict';

/** Counts alone also accept an assigned teammate's singleton. */
export function assertOwnMeetingItems(items, bookingId, hostId) {
  assert.deepEqual(items.map(({ id, hostUserId }) => ({ id, hostUserId })),
    [{ id: bookingId, hostUserId: hostId }]);
}

/** A forbidden response must not contain the protected DTO. */
export function assertConfigurationDenied(status, body) {
  assert.equal(status, 403);
  assert.equal(body.code, 'FORBIDDEN');
  for (const key of ['data', 'pages', 'users', 'grants']) assert.equal(Object.hasOwn(body, key), false);
}
