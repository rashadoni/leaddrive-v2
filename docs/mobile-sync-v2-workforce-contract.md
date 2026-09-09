# LeadDrive Field — sync v2 `workforce` active-workday read-only pilot contract

**Status:** server-first, read-only comparison pilot.
**Version:** 2.
**Compatibility:** additive to every v1 workforce endpoint. Protocol v1 stays
the sole authority for workday transitions, HRM requests, cancellations and
manager decisions.

## Conservative scope

`GET /api/v2/mtm/mobile/sync/workforce` returns only an active workday owned
by the authenticated Field agent (`MtmAgentWorkday.agentId`). A workday is in
scope only while its status is `STARTED` or `PAUSED`; transition to
`COMPLETED` emits `ACTIVE_STATE_EXIT`, while deletion/reassignment emits a
targeted tombstone and forces a stream-local rebuild for affected snapshot
readers.

The small projection contains: workday id/date, state, start/pause/completion
timestamps, accumulated paused seconds and update timestamp. It deliberately
excludes start/end GPS, event coordinates, accuracy, event notes, calendar and
schedule policy, completed history, HRM requests, request reasons, decision
notes and notifications. `availableActions` and live worked seconds remain
derived from the existing server state machine; the v2 reader does not create
a second write authority.

The existing `/api/v1/mtm/mobile/workday` and `/api/v1/mtm/mobile/hrm`
workspaces remain authoritative for completed workdays, calendar and HRM
history. A wider history or request projection needs a distinct owner-approved
privacy/horizon contract before it can enter v2.

## Admission and cursor

The endpoint requires all of:

1. authenticated mobile principal with `FIELD_EXECUTE`;
2. enabled tenant `workforce-hrm` entitlement;
3. a valid `x-field-device-id` selector;
4. an exact enabled, unexpired `mtm_mobile_sync_cohorts` row for the
   authenticated `(tenant, agent, device, workforce)` tuple.

Bootstrap publishes only the enrolled device state:

```json
{
  "modules": { "workforceHrm": { "enabled": true, "scopeVersion": "workforce:7" } },
  "syncV2": { "workforce": true, "workforceEpoch": "cohort-revision:workforce:7" }
}
```

`workforce` never inherits a `routes`, `visits` or `tasks` cohort. The opaque
cursor binds tenant, agent, device, stream and its per-agent scope revision.
It has the common fourteen-day v2 retention window, which covers the approved
seven-day offline guarantee. Initial snapshots are immutable/keyset paged and
expire in one hour. A completion/reassignment/deletion changes only the
affected workforce scope; a `409 MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED` rebuilds
only this cache/cursor and never clears a Field outbox, media queue or another
stream's cursor.

## Journal, failure isolation and rollback

Database triggers append a payload-free actor-addressed `workday` UPSERT or
tombstone in the same transaction as the existing workday row write. The
trigger runs before cohort enrollment to avoid cursor gaps around rollout;
ordinary active-state changes are UPSERTs, while completion/deletion/reassign
produce tombstones and scope fences. HRM request rows and workday event rows
are intentionally not journaled by this pilot.

The normal response/error behaviour is the shared v2 contract: invalid device
or cursor is stream-local, disabled cohort returns 403, snapshot/rate limits
return 429 with `Retry-After`, and a temporary 503 retries only this pull.
Neither a workforce failure nor a v2 cache rebuild blocks critical v1 workday
or Field mutations.

Rollback disables only the exact `workforce` cohort. The APK returns to its
v1 adapter; v2 journal/triggers/cache remain harmless, v1 endpoints and
idempotency rows remain untouched, and no outbox is cleared. Cohort expansion
requires the physical Android/offline/two-device and bounded-load evidence in
the rollout runbook.
