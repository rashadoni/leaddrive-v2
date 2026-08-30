# Workforce C2 — site-transition fact foundation

> **Checkpoint:** `WF-C2-007` foundation — 2026-08-30
>
> **Status:** implementation evidence for `WF-C2-007`. The immutable claim
> ledger is segment-snapshot-bound and C4 evidence/assessment records can now
> reference it; the C2 gate remains open for independent owner decisions.

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

## Segment and assessment linkage completion

An accepted transition now requires the same workday's immutable schedule
snapshot to contain the claimed `SITE` segment.  A later shift edit, employee
transfer or site assignment change therefore cannot make an old transition
appear to belong to a different segment.

`WorkforceAttendanceEvidence` has an exclusive subject relation to either a
workday event or a `WorkforceSiteTransition`, enforced with composite tenant
foreign keys.  Its append-only `WorkforceEvidenceAssessment` records derived
geofence/quality/policy outcomes without copying raw coordinates or ciphertext.
After raw evidence expires, the transition-linked redacted receipt and derived
assessment remain explainable while the exact payload is purged.

## Explicit boundary

This table deliberately stores **no** latitude/longitude, raw QR, device
signature, biometric value or Route customer/Route geofence reference. The
ledger and assessment link do not themselves prove physical presence or human
identity. There is still no public transition route or mobile-sync entity:
exposing a client claim before the C5/C9 proof-policy and mobile contracts
would create a false appearance of verified physical presence.

## Verification

Passed on Contabo as small sequential checks:

- `PASS` — serial targeted Vitest: `workforce-site-transition-facts`,
  `workforce-evidence-storage`, `migration-workforce-site-transitions`, and
  `migration-workforce-evidence-assessments`: **13 tests passed**.  It covers
  scheduled segment binding, bounded/replay-safe transition facts,
  transition-evidence foreign key and raw-free assessment linkage.
- `PASS` — `git diff --check`.

## Not run

- `prisma generate`: **NOT RUN** — the shared-host `codex-heavy-run` lock is
  unavailable; raw generation is intentionally not retried.
- Disposable-PostgreSQL migration apply/rollback: **NOT RUN** — no isolated
  database gate is available on Contabo.
- Full typecheck, build, browser E2E, Android and load: **NOT RUN** — these
  remain GitHub CI/approved-worker gates.
