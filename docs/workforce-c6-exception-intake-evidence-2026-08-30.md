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
- The server-only resolved-configuration adapter now independently derives
  that published expected start and grace from hash-verified effective shift
  and policy definitions. It rejects a schedule that is missing/tampered,
  a policy or shift outside its effective historical window, or a mismatched
  policy/shift team membership before the generic no-show proposal executes.
  The LeadDrive default therefore reaches this path with the approved
  09:00 Baku start and 15-minute policy grace, rather than a caller-supplied
  `PUBLISHED` flag or grace value.
- Draft/unknown schedules, non-working/holiday calendar days, approved
  leave/absence, an existing workday, incomplete observation and unexpired
  grace all fail closed to `DO_NOT_CREATE`.
- `PROPOSE_REVIEW_CASE` is not persistence. It creates neither a case nor a
  notification and cannot fabricate a start/finish fact. A later C6 lifecycle
  must perform tenant-scoped deduplication and an accountable immutable
  decision.
- A separate missed-finish proposal uses only an immutable workday schedule
  snapshot and a complete open-workday observation. It can propose a generic,
  private reminder after its configured grace or a human review after a later
  configured stale threshold. It can never generate a `FINISH` event, infer a
  finish time or reopen a completed workday.

## Explicitly not activated

This checkpoint does not configure a tenant taxonomy, severity, owner, SLA,
employee notice, no-show/delivery job, queue, notification, auto-close,
correction or appeal. It also does not change the legacy mutable
`WorkforceAttendanceException` rows, schema, API or approval behavior.

The resolved-configuration adapter is also not a scheduler, detector or
database writer. It does not materialize a daily expected-work record, create
an absence, insert an exception case or notify any employee/manager. A future
activation must use a complete tenant-scoped no-workday query, durable
deduplication and the reviewed C6 lifecycle rather than treating this source
adapter as operational evidence.

The owner-approved recommended v1 **draft** taxonomy, non-disciplinary triage
severity, role owner, targets and employee-visibility rule is now recorded in
[`workforce-c6-recommended-draft-policy-evidence-2026-08-30.md`](./workforce-c6-recommended-draft-policy-evidence-2026-08-30.md).
It remains deliberately non-active for every tenant. The durable additive
case/decision migration and actual detector remain WF-C6-002/003 work.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-exception-intake.test.ts \
          src/__tests__/workforce-calendar.test.ts \
          src/__tests__/workforce-timesheet-calculation.test.ts --reporter=dot
          (3 files, 20 tests)

    PASS  2026-08-31 resolved published-configuration re-check:
          `lib-workforce-exception-intake`, `workforce-shift-resolution` and
          `workforce-policy-resolution` (3 files, 31 tests), scoped ESLint
          and `git diff --check`. The adapter test covers the matching
          hash-verified Baku 09:00/15-minute configuration plus missing
          schedule, mismatched historical team and future-activation denial.

    NOT RUN  database migration/apply, full typecheck/build, browser E2E,
             Android, scheduler/concurrency/load and physical pilot checks:
             this source-only checkpoint has no worker/job or visible flow,
             and heavy gates belong to CI or an approved external worker.
