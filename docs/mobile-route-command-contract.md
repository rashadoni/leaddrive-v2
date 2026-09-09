# Route Field mobile route-command contract

This is an additive, mobile-only **v1** write transport for the standalone
LeadDrive Route Field APK. It is intentionally separate from the read-only
sync-v2 pilot: v2 remains a pull/shadow contract and is not a mutation
authority.

## Endpoint and admission

`POST /api/v1/mtm/mobile/route-commands`

- Requires a mobile JWT, fresh tenant capability `route-field`, and a valid
  opaque `x-field-device-id` header.
- The server resolves tenant, actor, role, capability and route ownership; the
  body never contains an `agentId`, assignment, tenant or manager override.
- Only the authenticated `AGENT` may use this endpoint, and only for a
  self-managed route. `ROUTE_SELF_PLAN` is required for drafts,
  `ROUTE_SELF_PUBLISH` for publication, and `ROUTE_EXECUTE` for starting a
  published route.
- The Route Field client window is the owner-approved current local calendar
  day plus the following six days. The server enforces it rather than trusting
  a device clock or UI.

## Command grammar

The APK persists the entire envelope before its first network attempt and
reuses the same `operationId` until a terminal response is known.

```json
{
  "operationId": "opaque-stable-operation-id",
  "command": "CREATE_DRAFT",
  "payload": {
    "date": "2026-09-02",
    "points": [{ "customerId": "...", "contactId": "...", "plannedTime": "..." }]
  }
}
```

Supported commands are:

- `CREATE_DRAFT` with `{ date, points }`.
- `UPDATE_DRAFT` with top-level `routeId` and `{ expectedVersion, points }`.
- `PUBLISH` with top-level `routeId` and `{ expectedVersion }`.
- `START` with top-level `routeId` and `{ expectedVersion }`. It accepts only
  a `PLANNED` route for the tenant's current local day, transitions it to
  `IN_PROGRESS`, and writes the server's current timestamp as `startedAt`.
  It does not create or modify a Workforce/HRM workday.

Unknown fields fail validation. A Route Field client must not fall back to
`/routes`, `/routes/:id`, or `/routes/:id/publish` for the same operation.
Those endpoints remain v1 compatibility paths for older clients only.

## Idempotency and terminal responses

The server derives a SHA-256 hash from a canonical command envelope containing
the command, target route ID and parsed payload. Tenant, actor, device and
operation ID are receipt scope, not trusted payload fields.

In one database transaction it:

1. locks the tenant/operation key and checks the receipt;
2. applies one canonical route mutation;
3. writes a route notification outbox row for `PUBLISH`;
4. writes the terminal receipt.

An exact retry returns the stored result with `idempotent: true` and performs
no route or notification write. A different actor, device, command, target or
payload under the same operation ID receives
`MOBILE_ROUTE_COMMAND_IDEMPOTENCY_MISMATCH` without seeing the original
result. Receipts expire after 90 days; an expired operation ID must be replaced
with a new one.

Only applied results and deterministic `409` route conflicts are terminal
receipts. Validation, capability/permission denial, missing target scope and
infrastructure failures are not pinned, so a temporary outage can never be
mistaken for a completed mutation.

## Retention, rollout and rollback

`mtm_mobile_route_command_receipts` is tenant-RLS-protected from its first
migration. The `mtm-cleanup` cron reaps only exact expired receipt IDs with a
separate bypass-only `route-commands` cursor: at most 10 tenants and 100 rows
per tenant per pass. It never deletes `mtm_sync_operations`, the legacy mobile
outbox, media, or sync-v2 data.

Rollout is server-first:

1. Apply the additive migration and deploy the server endpoint.
2. Verify receipt, RLS and retention telemetry with a non-production tenant.
3. Ship the Route Field APK command journal; it must use no direct-write
   fallback.
4. Keep v1 compatibility endpoints and the read-only v2 shadow intact.

Rollback disables APK use of the new endpoint or removes access at the tenant
capability boundary. It does not clear pending client commands, receipts or the
notification outbox. Destructive removal is a later, separately reviewed
migration after the supported retry horizon.
