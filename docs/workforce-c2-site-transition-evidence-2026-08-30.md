# Workforce C2 — site-transition fact foundation

> **Checkpoint:** `WF-C2-007` foundation — 2026-08-30
>
> **Status:** partial. The immutable claim ledger is implemented; C4 must add
> evidence collection/assessment and C3 must snapshot the resolved segment for
> an accepted workday before this becomes a complete attendance decision flow.

## Delivered contract

`WorkforceSiteTransition` records an employee's claimed `ARRIVAL` to or
`DEPARTURE` from one planned `WorkforceShiftSegment` inside one existing
`MtmAgentWorkday`.

- Inter-branch movement is a departure from the prior segment followed by an
  arrival to the next segment. It never opens a second workday.
- The row has organization/agent/workday/segment composite references, a
  client transition ID, C1-style claimed/captured/queued/server/applied timing
  and a canonical idempotency hash.
- The unique constraint permits at most one arrival and one departure per
  workday/segment. The database rejects a departure without an earlier arrival
  claim and rejects all updates/deletes.
- Claims older than seven days or more than five minutes in the future are
  rejected before any lookup. A delayed but in-window claim is stored as
  `PENDING_REVIEW`, not approved attendance.
- The transaction also writes an ordinary tenant audit projection. No claim is
  reported as a location verdict or a payroll result.

## Explicit boundary

This table deliberately stores **no** latitude/longitude, raw QR, device
signature, biometric value or Route customer/Route geofence reference. C4 must
attach method-specific evidence and an independent server assessment. C3-008
must snapshot the resolved segment/site/policy at the accepted action. There is
also no public transition route or mobile-sync entity yet: exposing a client
claim before the C4 proof policy and C9 mobile contract would create a false
appearance of verified physical presence.

## Verification

Passed on Contabo as small sequential checks:

```text
npx vitest run src/__tests__/workforce-site-transition-facts.test.ts \
  src/__tests__/migration-workforce-site-transitions.test.ts \
  src/__tests__/mocks/mtm-prisma.test.ts \
  --pool=forks --maxWorkers=1

3 files passed, 13 tests passed

npx eslint src/lib/workforce/site-transition-facts.ts \
  src/__tests__/workforce-site-transition-facts.test.ts \
  src/__tests__/migration-workforce-site-transitions.test.ts
PASS

DATABASE_URL=<inert> npx prisma validate --schema=prisma/schema.prisma
Prisma schema is valid

git diff --check
PASS
```

## Not run

- `prisma generate`: **NOT RUN** — the shared-host `codex-heavy-run` lock is
  unavailable; raw generation is intentionally not retried.
- Disposable-PostgreSQL migration apply/rollback: **NOT RUN** — no isolated
  database gate is available on Contabo.
- Full typecheck, build, browser E2E, Android and load: **NOT RUN** — these
  remain GitHub CI/approved-worker gates.
