# LeadDrive Field — sync v2 `routes` pilot contract

**Status:** server-first, read-only pilot.
**Version:** 2.
**Compatibility:** additive to `/api/v1/mtm/mobile/sync/pull`; v1 remains the
contract for installed APKs until a device is explicitly enrolled.

## Admission

`GET /api/v2/mtm/mobile/sync/routes` requires all of the following:

1. authenticated mobile principal with `FIELD_EXECUTE`;
2. tenant `route-field` entitlement;
3. a transport-safe `x-field-device-id` header;
4. a matching, enabled, non-expired row in `mtm_mobile_sync_cohorts` for the
   authenticated tenant, agent, device and `routes` stream.

The same cohort is checked by bootstrap before it advertises
`protocol.preferred: 2`, `syncV2.routes: true`, and a stable
`syncV2.routesEpoch`. The epoch combines the server-owned cohort revision and
per-agent route scope revision; it changes on actual enrollment/scope changes,
not on every bootstrap. An APK uses it to invalidate only its read-only v2
cache after a cohort rollback/re-enrollment. A client-provided protocol claim
or cursor never grants access. Commercial stays disabled for Field.

## Pull

Query parameters:

| Parameter | Meaning |
| --- | --- |
| `limit` | Optional page size, bounded to `1..500`; default `200`. |
| `cursor` | Opaque encrypted cursor from the preceding response. Omit it to begin a new snapshot. |

The initial response is a materialised snapshot:

```json
{
  "success": true,
  "protocolVersion": 2,
  "stream": "routes",
  "snapshotId": "opaque-server-id",
  "boundary": "opaque-delta-cursor",
  "items": [],
  "tombstones": [],
  "nextPage": "opaque-snapshot-cursor-or-null",
  "complete": false,
  "nextCursor": null
}
```

Rows are ordered by `route.date, route.id`, copied into immutable snapshot
items in a repeatable-read transaction, and paged by snapshot ordinal. The
client applies each page locally but persists the stream cursor only when
`complete: true`; only then is `nextCursor` present. Concurrent route writes
are either inside the snapshot boundary with their revision or appear in the
following delta. No timestamp/offset is accepted from the device.

Delta responses use the same envelope. `nextCursor` advances only through the
fully returned revision page; a caller asks again with that cursor while
`complete` is false. Tombstones have `{ entityType, id, revision, reason }`.
For each delta page, the APK combines `items` and `tombstones`, sorts the
combined records by their decimal `revision` ascending, and keeps the highest applied revision for each `(entityType, id)`.
It atomically persists that full page merge and its continuation cursor only
after every record was applied.
For an initial snapshot it instead keeps the committed stream cursor unset
until the final `complete: true` page. Replaying a page is therefore safe and
never lets a tombstone lose to an older UPSERT.

## Cursor, retention and recovery

Cursor claims are AES-GCM sealed and bind tenant, agent, device, `routes`, the
actor's **per-agent** scope revision, and a horizon fingerprint containing the
tenant timezone, local date and server inclusion-policy revision. They must not
be decoded or constructed by an APK. A timezone or horizon-policy change
therefore requires a controlled rebuild even if the local date string happens
to be unchanged. A delta cursor lasts 14 days, matching the change and
tombstone retention. Snapshot cursors last one hour.

The maintenance path advances `retentionFloorRevision` in the same transaction
that removes expired changes. A stale cursor, expired snapshot, changed scope
or changed horizon returns `409`; a restore that rewinds the journal does the
same with reason `STREAM_REWOUND` rather than moving a cursor backward:

```json
{
  "code": "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
  "resnapshotRequired": true,
  "reason": "RETENTION_EXPIRED"
}
```

with HTTP `409`. The client deletes/rebuilds **only its routes cache and
cursor**; it never clears its mutation outbox or media queue.

## Projection and visibility

The route projection includes route execution metadata, active non-observer
assignments and ordered points. It intentionally excludes route notes,
customer/contact names, addresses, free-form contact data, photos/media and
GPS coordinates. `customerId`/`contactId` are opaque joins only.

The stream includes the authenticated agent's primary routes and active
non-observer assignments within the approved seven-day-back/14-day-forward
field horizon (plus an active in-progress route). Database triggers append a
revision in the same transaction as route, route-point or assignment changes.
The compact, actor-addressed journal is deliberately retained for all eligible
route writes before a device cohort exists: cohort-gating the trigger itself
would create a blind spot around enable/disable and an old repeatable-read
writer could commit after a new snapshot with no delta. It contains no route
payload and expires after fourteen days; the manifest and endpoint remain
strictly exact-cohort-gated, and journal volume is a rollout metric.
An initial snapshot first claims a short, durable tenant/actor/device/horizon
lease in a Read Committed statement, then materialises under Repeatable Read.
A parallel no-cursor retry receives `429`/`Retry-After` instead of waiting
with an obsolete MVCC snapshot or creating a second materialised copy; its
next attempt starts fresh and reuses the committed snapshot. Leases expire
after a failed builder and are retained only as rebuildable state.
Membership changes take a route advisory lock and advance a per-agent scope
fence in that same transaction. Every snapshot/delta page locks and compares
that fence before reading, so a committed revoke returns `409` instead of an
immutable stale page. Every routes journal record — including UPSERTs and
scope-removal tombstones — is addressed to exactly one current Field actor.
No device scans, acknowledges, or receives another actor's route activity. A
route-date/status change that may cross the horizon produces the same
controlled per-agent rebuild rather than leaving a stale row on device. None
of this forces unrelated tenant devices to resnapshot.
If a route point or assignment is transferred between routes, both route
audiences are locked in a deterministic order: old viewers receive the
updated old-route projection, and a removed actor receives its own tombstone
and scope fence before the new-route projection is delivered.

## Error and load control

| HTTP | Code | Client action |
| --- | --- | --- |
| 400 | `MOBILE_SYNC_V2_DEVICE_REQUIRED` / cursor invalid | Repair local configuration or discard only the invalid stream cursor. |
| 403 | `MOBILE_SYNC_V2_COHORT_DISABLED` | Fall back to the compatible v1 adapter; do not retry v2. |
| 409 | `MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED` | Rebuild the routes stream; retain outbox/media. |
| 413 | `MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE` | Retry from the original cursor (or begin a new snapshot) with the returned `recommendedPageSize`. |
| 429 | `MOBILE_SYNC_V2_SNAPSHOT_LEASE_BUSY` | Respect `Retry-After: 2` and retry the same initial request; do not clear any local state. |
| 429 | `MOBILE_SYNC_V2_RATE_LIMITED` | Respect the returned bounded `Retry-After` (at most 60 seconds) with client jitter. |
| 503 | `MOBILE_SYNC_V2_UNAVAILABLE` | Respect `Retry-After: 5`; retry this pull independently. |

Each v2 pull atomically reserves exact device, authenticated-user and tenant
budgets in the shared Redis guard. No rejected bucket spends another bucket's
budget; production guard unavailability returns the existing stream-local
`503 MOBILE_SYNC_V2_UNAVAILABLE` and never falls back to the legacy
in-process limiter. The v1 pull and every mutation/outbox path remain
unchanged. Structured pull telemetry contains only a HMAC tenant dimension,
stream/endpoint/contract/APK version, result class, row/byte count and
duration; it never logs a cursor, device identifier, route payload, GPS point
or user-entered note.

## Rollout and rollback

1. Deploy schema, RLS policies, triggers, endpoint and retention maintenance.
2. Enrol one tenant/device cohort only after protocol/pagination/chaos checks.
3. Compare v1 and v2 reads before any client cutover.
4. To roll back, disable/delete cohort rows. v1 continues unchanged; schema is
   retained until the supported-APK census and backup/restore rehearsal permit
   a separately reviewed destructive migration.
