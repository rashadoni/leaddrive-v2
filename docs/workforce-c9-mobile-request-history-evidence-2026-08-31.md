# Workforce C9 — employee request status history (2026-08-31)

## Scope

This slice narrows the ordinary employee mobile request-history response and
makes its server-authoritative status chronology visible. It preserves the
existing self-only create and pending-cancellation flows; it does not create a
new approval flow, local approval state or evidence-export path.

The mobile HRM history endpoint now uses an explicit request projection. A
history item contains only the request identity, kind, terminal/current status,
request date/time scope, the employee-visible decision note, and submitted /
decision / cancellation timestamps. The Android client renders valid server
timestamps on the tenant's history timezone and expands one request at a time.
Unknown timestamps and impossible status/timestamp pairings are omitted rather
than turned into a locally invented event.

## Data-minimisation boundary

- The normal status read no longer selects or returns the employee's free-text
  request `reason` or the `clientRequestId` idempotency key. Both remain in the
  protected submission path where they are required for idempotency and are
  excluded from audit/diagnostic projections.
- The response still has no raw location, QR, device proof, operation receipt,
  audit record, exception response ledger or manager identity.
- A decision note is intentionally limited to the employee's own request and
  is parsed only up to the server decision schema's 1,000-character limit. It
  is not a location/identity proof and no automatic workforce outcome is
  inferred from its text.
- An offline submit/cancel remains a pending encrypted-outbox operation, not a
  history fact. Recovery/conflict handling remains C9-010.

## Verification

Passed in this worktree:

```text
vitest: api-mtm-mobile-hrm + workforce-android-foundation
24 tests passed
scoped ESLint and git diff --check passed
```

`NOT RUN`: Android Gradle lint/unit and device accessibility verification for
this SHA, browser E2E, Prisma migration apply, staging, load/restore and the
physical pilot. Those require GitHub CI, a device, or an isolated external
environment and are not inferred from source tests.
