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
- A no-show case subject now carries both the immutable published shift
  `segmentId` and its exact `expectedWorkDate`. That additive date is part of
  the raw-proof-free deduplication key, so a recurring Monday shift cannot
  cause a missed start for one date to suppress review for another date. The
  ledger rejects an expected date without a segment and rejects mixing this
  scheduled subject with a concrete accepted workday/event or evidence link.
  The migration
  preserves tenant RLS and append-only guards; it neither creates case rows
  nor turns a proposal into an operational detector.
- Draft/unknown schedules, non-working/holiday calendar days, approved
  leave/absence, an existing workday, incomplete observation and unexpired
  grace all fail closed to `DO_NOT_CREATE`.
- The persisted historical-calendar resolver accepts an expected-work instant
  and reads the append-only team membership at that instant. A later transfer
  cannot make a past no-show check pick up the employee's current team's
  closure or holiday; missing membership history falls back only to the
  employee and organization calendar candidates, never the mutable directory
  team.
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
activation must use a complete tenant-scoped no-workday query, the new
segment-plus-date deduplication subject and the reviewed C6 lifecycle rather
than treating this source adapter as operational evidence.

### 2026-09-01 read-only candidate reader

`readWorkforceNoShowCandidate` is the first server-side composition of the
safe inputs. For one explicit employee/date/as-of instant it:

- resolves the shift again at its own planned start, so a later activation
  cannot backdate a no-show expectation;
- resolves policy and the effective calendar against that same historical
  instant, including append-only team membership rather than the employee's
  later directory team;
- requires an explicit `HIRE` or `REHIRE` employment fact at that instant;
  missing lifecycle is not inferred from the mutable directory and a
  `TERMINATION` never becomes a no-show;
- checks the unique organization/employee/work-date workday row;
- accepts only sequence-one published segments that begin at the signed shift
  start; and
- returns either an in-memory review draft, a non-creation proposal, or an
  explicit not-ready result.

It has a deliberately read-only Prisma surface: no case writer, audit writer,
queue, notification, capability or tenant control is available to it. A shift
with no matching published first segment is not assigned a made-up generic
subject. The reader does not catch resolver/database errors as an absence;
the eventual leased worker must record those as incomplete observations and
write nothing.

### 2026-09-01 bounded no-show candidate batch

`readWorkforceNoShowCandidateBatch` reads at most 50 employee IDs in stable
tenant-local order and calls the single-candidate reader sequentially. It
returns only in-memory next-cursor metadata; the cursor is not persisted and
is not a job lease. The batch reader intentionally has no case, audit,
notification, queue, capability or tenant-control method, so it cannot turn a
scheduled scan into an operational detector. An exception from a single
candidate is propagated rather than transformed into an absence; a future
leased worker must record that incomplete observation and write nothing.

### 2026-09-01 read-only missed-finish candidate reader

`readWorkforceMissedFinishCandidate` composes the existing pure
missed-finish proposal with one exact organization/employee/workday read and
its immutable shift snapshot. It:

- accepts only the canonical open `STARTED` or `PAUSED` workday states;
- returns no action without even reading a snapshot for an already
  `COMPLETED` workday;
- refuses a missing, cross-scope or malformed immutable planned-end snapshot;
  and
- requires explicit internal reminder/review timing from the caller rather
  than silently choosing a global tenant policy.

Its database surface has no writer, audit, case, notification, queue,
capability or tenant-control method. An actionable result is still only an
in-memory generic-reminder or human-review candidate; it cannot emit a
notification, create an exception, write a correction or fabricate a
`FINISH` fact. Durable timing selection, delivery, leases, case lifecycle
and any auto-close policy remain deliberately inactive.

### 2026-09-01 bounded missed-finish candidate batch

`readWorkforceMissedFinishCandidateBatch` reads at most 50 existing
`STARTED`/`PAUSED` workdays in stable tenant-local order, then calls the
single-workday reader sequentially with the caller's explicit timing. Its
cursor is in-memory continuation metadata only — not a lease, scheduled job or
delivery record. The batch reader exposes no writer, audit, case,
notification, queue, correction or capability method, so a generic reminder
candidate cannot become a delivered reminder or an automatic finish.

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

    PASS  2026-09-01 expected-date case-subject re-check:
          `lib-workforce-exception-intake`, case ledger/writer and lifecycle/
          subject-integrity/new expected-date migration contracts (6 files,
          32 tests); Prisma validate/generate with a non-routable validation
          URL; scoped ESLint and `git diff --check`.

    PASS  2026-09-01 historical-calendar re-check:
          `workforce-calendar`, `workforce-policy-resolution` and
          `workforce-shift-resolution` (3 files, 26 tests), scoped ESLint and
          `git diff --check`. A later directory transfer cannot add its team
          calendar candidate to a past expected-workday lookup.

    PASS  2026-09-01 candidate-reader re-check:
          no-show candidate, intake, historical calendar, policy and shift
          resolver contracts (5 files, 41 tests), scoped ESLint and
          `git diff --check`. The reader proves review-draft, existing-workday,
          unsegmented-template and unscheduled-weekday paths without a case or
          audit write.

    PASS  2026-09-01 missed-finish candidate-reader re-check:
          missed-finish/no-show/intake contracts (3 files, 19 tests), scoped
          ESLint and `git diff --check`. The reader proves exact open-workday
          reminder/review candidates, completed-workday no-read/no-action and
          missing-snapshot fail-closed outcomes, with no case/audit writer.

    PASS  2026-09-01 employment-aware no-show re-check:
          no-show, employment-history, historical calendar/policy/shift
          contracts (5 files, 36 tests), scoped ESLint and `git diff --check`.
          A terminated employee stops before calendar/workday lookup; unknown
          lifecycle also fails closed without a case/audit write.

    PASS  2026-09-01 bounded missed-finish-batch re-check:
          missed-finish batch/reader/intake contracts (3 files, 17 tests),
          scoped ESLint and `git diff --check`. Tenant scope, open-state
          predicate, 50-row bound and no case/audit writer are pinned.

    PASS  2026-09-01 bounded no-show-batch re-check:
          batch/no-show/employment contracts (3 files, 12 tests), scoped
          ESLint and `git diff --check`. The test pins tenant scope,
          50-row bound, stable continuation metadata and no case/audit write.

    NOT RUN  database migration/apply, full typecheck/build, browser E2E,
             Android, scheduler/concurrency/load and physical pilot checks:
             this source-only checkpoint has no worker/job or visible flow,
             and heavy gates belong to CI or an approved external worker.
