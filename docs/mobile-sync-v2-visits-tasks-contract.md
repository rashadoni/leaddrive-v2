# LeadDrive Field — sync v2 `visits` and `tasks` read-only pilot contract

**Status:** server-first, read-only comparison pilots.
**Version:** 2.
**Compatibility:** additive to every v1 Field pull/push endpoint. Protocol v1 remains the sole mutation authority until a separately evidenced cutover.

## Conservative S4 scope

This contract intentionally takes the smallest safe step after `routes`.

| Stream | Audience | Inclusion horizon | Projection intentionally excludes |
| --- | --- | --- | --- |
| `visits` | Only `MtmVisit.agentId` equal to the authenticated Field agent | Non-deleted `CHECKED_IN` visits | Customer/contact IDs and names, all GPS, notes/result notes, requirements/actions, photos/documents and media URLs |
| `tasks` | Only `MtmTask.agentId` equal to the authenticated Field agent | Non-deleted `PENDING`, `IN_PROGRESS` or `OVERDUE` tasks | Customer data, title/description, result/return reason, source key, recurrence data, event comments/evidence and all media |

The participant workspace remains the v1 on-demand endpoint. A v2 reader must
not infer that `MtmVisitParticipant` grants stream access: that would broaden
the v1 pull audience without a reviewed privacy/tombstone contract. Terminal
history is out of scope. Any later horizon expansion changes its policy
version and forces a stream-local resnapshot.

The visit projection contains only execution metadata: id, route references,
status, check-in/out timestamps, duration, outcome, potential, next-action
timestamp and update timestamp. The task projection contains only schedule and
state metadata: id, optional visit reference, status, priority, planned/due/
completed timestamps, progress, optimistic version, accepted/started times and
update timestamp. It contains no opaque customer/contact identifier either.

## Admission and manifest

`GET /api/v2/mtm/mobile/sync/visits` and
`GET /api/v2/mtm/mobile/sync/tasks` each require:

1. authenticated mobile principal with `FIELD_EXECUTE`;
2. tenant `route-field` entitlement;
3. a valid `x-field-device-id` selector;
4. an exact, enabled, non-expired `mtm_mobile_sync_cohorts` row for the
   authenticated `(tenant, agent, device, stream)`.

Bootstrap returns independent additive values:

```json
{
  "syncV2": {
    "routes": false,
    "routesEpoch": null,
    "visits": true,
    "visitsEpoch": "cohort-revision:visits:scope-revision",
    "tasks": true,
    "tasksEpoch": "cohort-revision:tasks:scope-revision"
  }
}
```

One stream's cohort never permits another. Missing/malformed epoch, a revoked
device or a disabled tenant module keeps that stream on v1. The endpoint
repeats every server-side check; neither an APK protocol claim nor a cursor
grants access.

## Pull, cursor and recovery

Both endpoints use the existing v2 envelope and sealed cursor format. Initial
rows are materialised in deterministic `id` keyset order inside Repeatable
Read. The server first claims a short durable tenant/agent/device/stream lease;
the client stores its delta cursor only on the final `complete: true` page.
The cursor binds tenant, primary agent, device, stream, per-agent scope
revision and the active-horizon policy key. Delta cursors last fourteen days;
snapshot pages last one hour.

Visit/task writes append an actor-addressed, payload-free journal record in the
same transaction. Standard active updates emit an UPSERT. Soft/hard delete,
active-to-terminal transition and reassignment issue a tombstone for the
previous primary agent. Reassignment and horizon entry/exit advance only that
agent's scope fence. Snapshot/delta pages lock the fence before reading, so a
committed revoke/reassignment yields controlled `409
MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED`, never stale disclosure.

Tombstones retain the existing fourteen-day v2 window. Retention cleanup moves
the floor atomically with journal deletion. Expired, foreign, rewound or
scope/horizon-invalid cursors rebuild only this stream; Field outbox, local media and other cursors are never cleared.

## Error, telemetry and rollback

| HTTP | Code | Client action |
| --- | --- | --- |
| 400 | device/cursor invalid | Repair only the invalid stream state. |
| 403 | `MOBILE_SYNC_V2_COHORT_DISABLED` | Return to v1 for this stream; do not poll v2. |
| 409 | `MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED` | Rebuild only this cache/cursor; retain all outboxes. |
| 413 | `MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE` | Retry the same cursor with a smaller page. |
| 429 | snapshot lease/rate limit | Honour `Retry-After` plus client jitter. |
| 503 | `MOBILE_SYNC_V2_UNAVAILABLE` | Retry this pull independently; never block Field pushes. |

Telemetry includes only tenant HMAC, stream, endpoint, contract/APK version,
result class, row/byte count and duration. It never includes a cursor, device
identifier, customer/task text, GPS or media data.

Rollback disables only the exact `visits` or `tasks` cohort. New APK code falls
back to v1 while v2 schema/journal/cache remain harmless. Never clear an
outbox, add a v2 writer, or remove v1 endpoints/idempotency records during a
rollback.
