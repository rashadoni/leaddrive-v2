# Workforce C1c — delayed-claim review evidence

> **Status:** `WF-C1-003` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T01:11:00+02:00
> **Scope:** server-side Workforce workday ledger and its existing web/mobile
> adapters. This is not an HR approval, legal sign-off, physical-device test or
> production activation.

## Safe default now recorded

The active task authorizes recommended, reversible technical defaults. C1c
therefore records a narrow initial rule: a claim inside the existing seven-day
offline horizon whose server receipt is **more than 15 minutes** after its
server-validated `claimedAt` becomes `PENDING_REVIEW` with reason
`DELAYED_CLAIM` and policy version `c1-delay-review-v1`.

The rule does **not** reject the workday transition, assert physical presence,
approve a timesheet, calculate payroll or support disciplinary action. It adds a
human-review signal only. A later C6 tenant policy/resolution lifecycle must
make the threshold configurable, show the employee/manager workflow and record
the accountable resolution. Claims older than seven days remain rejected by
the shared C1 parser; web submissions retain their stricter five-minute online
freshness limit.

## Immutable, tenant-scoped evidence

The additive migration introduces:

- `LEGACY_UNKNOWN`, `NOT_REQUIRED` and `PENDING_REVIEW` states on the immutable
  workday event. Existing history remains `LEGACY_UNKNOWN`; no migration
  fabricates a normal or trusted review state.
- `WorkforceAttendanceReviewCase`, keyed to the exact organization/event and
  carrying only agent/workday/event identity, reason, policy version and the
  claim/receipt timestamps/age needed to reconstruct the decision.
- composite tenant foreign keys, an event-match trigger, append-only protection
  before C6, restrictive RLS policies and application grants limited to the
  C1 insert/read surface.

No raw coordinates, QR token, device signature, biometric template or device
attestation is copied into the review case. The workday event and existing
verification ledger remain the separate sources of evidence.

The shared parser derives the state on the server. The workday event, review
case, normal audit projection and mobile-sync result pin are all created inside
the existing interactive workday transaction. If review-case insertion fails,
the accepted event and client success response cannot commit. A replay reads
the stored immutable state and never creates another case.

## API compatibility

The existing week and mobile-sync responses now return a compact `review`
object. New events are `NOT_REQUIRED` or `PENDING_REVIEW`; an old pre-C1 event
is explicitly `LEGACY_UNKNOWN`. This prevents a newer client from interpreting
missing historical evidence as an affirmative assurance.

## Verification run in this worktree

- `PASS` — `DATABASE_URL=<inert validation URL> npx prisma validate`; schema
  validation only, with no connection or database mutation.
- `PASS` — `npx prisma generate`; generated local Prisma client includes the
  review model and event fields.
- `PASS` — `git diff --check`.
- `PASS` — targeted Vitest: `lib-mtm-workday`,
  `migration-workforce-c1-review-cases`, `api-mtm-week` and
  `api-mtm-mobile-sync`: **153 tests passed**. It covers the 15-minute
  disposition, transaction-local case creation, migration safeguards and both
  response contracts.
- `PASS` — targeted ESLint for changed production sources and new migration
  test. The shared Prisma mock retains one pre-existing unused-argument warning;
  no changed production source has an ESLint error.
- `NOT RUN` — migration apply/rollback/reconciliation against an isolated
  PostgreSQL database; no database is attached to this worktree.
- `NOT RUN` — full typecheck, build, browser E2E, Android/device and load
  tests. The Contabo host contract assigns these to `codex-heavy-run`, GitHub
  CI or an approved worker.

## Remaining C1 work

`WF-C1-004` remains partial until C2 supplies an immutable multi-site segment
identifier for the request digest. Effective-dated assignment snapshots,
clock/anomaly risks, recovery UX, migration rehearsal and abuse matrix remain
separate C1 tasks. C1 is not a production attendance or location pilot.
