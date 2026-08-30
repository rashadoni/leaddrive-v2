# Workforce C6 exception-intake foundation evidence

**Status:** WF-C6-001 and WF-C6-003 partial
**Date:** 2026-08-30

## Delivered safe boundary

`src/lib/workforce/exception-intake.ts` introduces a pure intake boundary for
the existing calculated deviations (`LATE_START`, `UNDERTIME`, `OVERTIME` and
`LONG_PAUSE`) and a prospective no-show detector.

- Every calculation deviation remains a review-only intake. `OVERTIME` is
  explicitly labelled an operational, non-payable deviation.
- The baseline intentionally sets no severity, no accountable owner and no
  SLA. It cannot auto-resolve, discipline, pay, notify or alter a workday.
- A possible no-show can be proposed only when a complete tenant-scoped
  observation sees no workday after a **published** expected schedule has
  passed its explicit grace period, the effective calendar is eligible and
  the employee is not excused.
- Draft/unknown schedules, non-working/holiday calendar days, approved
  leave/absence, an existing workday, incomplete observation and unexpired
  grace all fail closed to `DO_NOT_CREATE`.
- `PROPOSE_REVIEW_CASE` is not persistence. It creates neither a case nor a
  notification and cannot fabricate a start/finish fact. A later C6 lifecycle
  must perform tenant-scoped deduplication and an accountable immutable
  decision.

## Explicitly not activated

This checkpoint does not configure a tenant taxonomy, severity, owner, SLA,
employee notice, no-show job, queue, reminder, auto-close, correction or
appeal. It also does not change the legacy mutable
`WorkforceAttendanceException` rows, schema, API or approval behavior.

HR/Product must approve the taxonomy, severity/owner/SLA and the employee
communication rule before WF-C6-001 can be complete. The durable additive
case/decision migration and actual detector remain WF-C6-002/003 work.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-exception-intake.test.ts \
          src/__tests__/workforce-calendar.test.ts \
          src/__tests__/workforce-timesheet-calculation.test.ts --reporter=dot
          (3 files, 20 tests)

    NOT RUN  database migration/apply, full typecheck/build, browser E2E,
             Android, scheduler/concurrency/load and physical pilot checks:
             this source-only checkpoint has no worker/job or visible flow,
             and heavy gates belong to CI or an approved external worker.
