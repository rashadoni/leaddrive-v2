# Workforce C6 immutable exception case/decision foundation evidence

**Status:** WF-C6-002 partial
**Date:** 2026-08-30

## Delivered additive contract

The additive Prisma source and migrations
`20260830170000_workforce_exception_case_lifecycle` and
`20260830173000_workforce_exception_case_subject_integrity` introduce and
harden two tenant-scoped ledgers without changing legacy calculated exception
rows:

- `WorkforceExceptionCase` is an immutable detector envelope with a stable
  SHA-256 `deduplicationKey`, employee and optional workday, workday-event
  (claim), restricted evidence and published shift-segment references.
- A case requires a workday, event or segment subject; evidence cannot be its
  only subject. Insert-time checks prove workday/event links belong to the
  same tenant employee. The hardening migration also proves that a linked
  evidence record belongs to that same employee and workday, and that any
  case segment linked to a concrete day is present in that day's immutable
  schedule snapshot. Raw location, QR token, device proof, employee text and
  mutable status are absent from the model.
- The tenant-scoped uniqueness constraint on `(organizationId,
  deduplicationKey)` is the database concurrency fence: competing detectors
  cannot create two cases for an identical detector subject.
- `WorkforceExceptionDecision` is a separate append-only accountable action
  with an idempotent operation ID, decision code, bounded reason and actor.
  Cases have no mutable resolved status: a later reviewed service must derive
  lifecycle state from the decision stream and its approved policy.
- Both tables have RLS, only `SELECT`/`INSERT` policies, immutable mutation
  triggers and no application update/delete grant.

`src/lib/workforce/exception-case-ledger.ts` constructs strict raw-proof-free
case and decision drafts. It has no Prisma client or live writer; its stable
deduplication hash makes retries deterministic before a later transaction uses
the database uniqueness fence.

Segment-only no-show proposals remain permissible at this storage boundary:
they have no accepted START snapshot yet. Their schedule detector, grace
timing, case writer and employee lifecycle remain separately disabled until
the approved C6 policy/RACI exists.

## Explicitly not activated

No tenant taxonomy/severity/owner/SLA, endpoint, queue, detector, employee
notification/appeal UI, manager authorization, decision vocabulary, migration
apply or legacy-row conversion is enabled. The existing
`WorkforceAttendanceException` table and timesheet approval behavior are
unchanged. No case may be treated as a payroll or disciplinary outcome.

The following remains required before WF-C6-002 can become `DONE`: owner
taxonomy/RACI, a forward-only applied migration, tenant-scoped transaction
writer with conflict/retry evidence, employee-visible lifecycle, reviewed
decision semantics and browser/physical rollout evidence.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-exception-case-ledger.test.ts \
          src/__tests__/migration-workforce-exception-case-lifecycle.test.ts \
          src/__tests__/workforce-reconciliation.test.ts \
          src/__tests__/lib-workforce-exception-intake.test.ts --reporter=dot
          (4 files, 20 tests)
    PASS  DATABASE_URL=<non-routable validation URL> npx prisma validate \
          --schema prisma/schema.prisma

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/migration-workforce-exception-case-subject-integrity.test.ts \
          src/__tests__/migration-workforce-exception-case-lifecycle.test.ts \
          src/__tests__/lib-workforce-exception-case-ledger.test.ts --reporter=dot
          (3 files, 9 tests)
    PASS  targeted ESLint for the new migration contract test and
          `git diff --check`.

    NOT RUN  Prisma generate/migration apply, full typecheck/build, browser
             E2E, Android, detector/decision transaction concurrency, jobs,
             load and physical pilot checks. Applying schema changes requires
             the approved CI/staging route; heavy gates do not run on Contabo.
