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
   `REVIEW_REQUIRED`, or `UNAVAILABLE`) with the shared C4 reason codes.

If the evidence write, encryption key or assessment write is unavailable, the
surrounding transaction rolls back. The app therefore cannot receive a
server-accepted location-required attendance fact without its associated
encrypted evidence receipt.

## Deliberate limits

- A quality-eligible coordinate is not an inside/outside result. This slice
  does **not** choose a live site, infer a site from an action, or add a
  `GEOFENCE` assessment. A later evaluator needs an immutable matching
  segment/site/geofence snapshot.
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
vitest: 5 focused files / 167 tests
  attendance trust, encrypted evidence storage, new event-bound writer,
  canonical week writer and mobile sync writer
eslint: changed production modules, two canonical routes and focused tests
git diff --check
```

`NOT RUN`: full typecheck/build, Prisma validate/generate/migration apply
without a disposable `DATABASE_URL`, Android Gradle/unit for this SHA,
browser E2E, raw-retention execution, isolated staging/load/restore, physical
permission/GPS/QR/device matrix and LeadDrive pilot.
