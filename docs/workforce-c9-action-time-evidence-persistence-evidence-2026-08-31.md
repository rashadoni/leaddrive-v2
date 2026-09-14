# Workforce C9 — action-time location evidence persistence (2026-08-31)

## Scope

This C9 slice connects an accepted, policy-required action-time location claim
to the existing Workforce encrypted evidence ledger. It is deliberately a
server-side follow-up to the v4 transport contract, not a new collection mode
or an activation of a tenant location policy.

For an accepted location-required workday action, inside the same canonical
workday transaction, the server now:

1. carries the already quality-eligible sample in memory until the immutable
   workday-event ID exists;
2. builds a strict `LOCATION` evidence envelope whose operation reference is
   that immutable event, not a client-device identifier;
3. encrypts the raw envelope with tenant- and column-bound encryption, gives
   it the existing 30-day raw expiry, and writes only a redacted receipt beside
   it;
4. derives an ephemeral, domain-separated per-tenant HMAC key from the
   server-only PII master key to bind that receipt; and
5. appends a raw-free `LOCATION_QUALITY` assessment (`ELIGIBLE`,
   `REVIEW_REQUIRED`, or `UNAVAILABLE`) with the shared C4 reason codes; and
6. when (and only when) the accepted event instant falls into an immutable
   snapshotted `SITE` segment, evaluates the encrypted-envelope data against
   that segment's snapshotted circle and appends a separate raw-free
   `GEOFENCE` verdict.

If the evidence write, encryption key or assessment write is unavailable, the
surrounding transaction rolls back. The app therefore cannot receive a
server-accepted location-required attendance fact without its associated
encrypted evidence receipt.

## Immutable site binding

The geofence path does not accept a mobile-selected site/segment ID. After the
canonical event and, for `START`, the workday snapshots exist in the same
transaction, the server resolves the segment from the accepted event timestamp,
the snapshotted local work date, timezone and ordered segment windows. It reads
the matching site's copied geofence revision from that same snapshot; it never
falls back to a live schedule, transfer, site or geofence row.

- A `SITE` interval with a valid circle produces an `INSIDE`, `OUTSIDE` or
  boundary `UNKNOWN` assessment using the existing accuracy-circle evaluator.
- A `SITE` interval whose immutable geofence is absent/invalid produces the
  explicit `GEOFENCE_SNAPSHOT_MISSING` `UNKNOWN` assessment.
- An off-schedule, malformed, remote, field, travel, on-call or exception
  interval remains a location-quality receipt only. It must not be turned into
  a guessed site/presence result.

The geometry verdict is operational evidence only. It does not itself change a
workday, pay, disciplinary state or employee identity and it does not create a
C6 exception case. That case lifecycle requires a separately activated,
accountable tenant policy.

## Deliberate limits

- A quality-eligible coordinate is not an inside/outside result by itself.
  This slice chooses neither a live site nor a client-supplied site; it writes
  a `GEOFENCE` assessment only through the immutable timing/snapshot binding
  above.
- A rejected low-quality or unavailable sample still fails the action before a
  canonical event is created. It is not silently converted into a presence
  fact, and this slice does not retain raw rejected samples merely for a
  security log.
- This creates no exception case, automatic correction, payroll effect,
  background tracking, active tenant policy or client-controlled review
  decision. C6 owns accountable case lifecycle after its policy/snapshot
  inputs exist.
- No migration apply, raw-evidence purge, tenant policy activation, staging,
  physical Android proof or production change was performed.

## Verification

Passed in this worktree:

```text
vitest: 8 focused files / 92 tests
  action-time writer/snapshotted site selection, multi-site scenario,
  attendance trust, encrypted evidence storage, canonical week writer,
  mobile sync writer and v4 migration contract
```

`NOT RUN`: full typecheck/build, Prisma validate/generate/migration apply
without a disposable `DATABASE_URL`, Android Gradle/unit for this SHA,
browser E2E, raw-retention execution, isolated staging/load/restore, physical
permission/GPS/QR/device matrix and LeadDrive pilot.
