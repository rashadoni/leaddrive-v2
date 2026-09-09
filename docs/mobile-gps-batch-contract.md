# LeadDrive Field — GPS batch contract

**Status:** server-first additive v2 ingestion foundation. Existing
`/api/v1/mtm/mobile/location` remains available for installed APKs and is not
replaced by this endpoint.

Deploy the additive Prisma migration and generate the Prisma client before
deploying code that reads the latest-location projection. The APK rollout is
strictly later and remains cohort-gated; a failed migration means this v2
feature is not enabled.

## Endpoint

`POST /api/v2/mtm/mobile/location/batch` accepts one authenticated Field
agent's points:

```json
{
  "workdayId": "optional-explicit-workday",
  "points": [
    {
      "clientLocationId": "durable-device-id",
      "latitude": 40.4093,
      "longitude": 49.8671,
      "accuracy": 8,
      "speed": 2.1,
      "recordedAt": "2026-08-28T09:00:00Z"
    }
  ]
}
```

It requires mobile JWT/RLS, `FIELD_TRACK`, and the tenant `route-field`
capability. It is additionally off until the authenticated agent/device has an
exact server-owned `gps` cohort row; a valid `x-field-device-id` is required
and is only a selector, never an opt-in. Tenant and agent always come from
authentication. It accepts `1..50` points and a JSON envelope no larger than
256 KiB. Every point needs a
unique `clientLocationId`, valid coordinates/metrics and a timestamp no more
than seven days old or five minutes in the future. The server resolves the
active workday (or validates the supplied one) and checks the window both
before and inside the write transaction.

## Idempotency and partial failures

The durable key is `(tenant, agent, clientLocationId)`. A SHA-256 digest binds
the point's coordinates, metrics, `recordedAt` and **server-resolved workday**.
An exact replay returns the same ID under `replayedClientLocationIds`; a reused
ID with different data returns `409 MTM_LOCATION_ID_CONFLICT`. A legacy raw
row without a digest is intentionally not treated as an exact v2 replay.

The response separates `appliedClientLocationIds` and
`replayedClientLocationIds`; it never echoes raw coordinates. A short
concurrent unique-key race is re-read once. If it remains hot, the server
returns `503 MTM_LOCATION_BATCH_CONCURRENT_RETRY` with `Retry-After: 1` so the
device retains its batch and retries with jitter.

`429 MTM_LOCATION_BATCH_RATE_LIMITED` and
`503 MTM_LOCATION_BATCH_GUARD_UNAVAILABLE` also include bounded
`Retry-After`. Rate limits are independent by tenant, user and device. GPS is
not part of the business mutation outbox or sync change log.

## Projection, retention and privacy

The raw append and `mtm_agent_latest_locations` projection update atomically.
The projection only advances for a non-older `recordedAt`, so delayed offline
history cannot move a live map marker backwards. Existing live-map reads use
it first and retain a read-only raw-table fallback while deployments/backfill
catch up; no second authoritative write path is introduced.

The owner-approved raw GPS retention is fixed at 30 days for standard and
enterprise. `/api/cron/mtm-cleanup` deletes at most 5,000 raw rows and 5,000
projection rows per run, reports whether more is pending, and uses the same
cutoff for both. This avoids one catch-up cleanup hurting interactive Field
traffic. Telemetry contains HMAC tenant, endpoint, result, point count, APK
version and duration only—never coordinates, IDs, workday IDs or raw payloads.

For pre-projection raw rows, the privileged
`/api/cron/mtm-latest-location-reconcile` repair processes exactly one
operator-selected tenant and at most 25 agents per request. Its continuation
is sealed, expires quickly and returns only aggregate counts; it never updates
or deletes raw GPS, v1 idempotency or an outbox. The caller must round-robin
tenants and retain/retry the returned continuation; this bounded repair is not
an autonomous global scheduler or a substitute for a durable fairness lease.

Physical time partitioning of the pre-existing raw GPS table remains a
separately rehearsed production migration: it must be benchmarked and rolled
out after the S6 load baseline, not performed as an untested rewrite of live
tenant location data.
