# Workforce C11 — exception aggregate report evidence

**Status:** `WF-C11-007` partial safe reporting slice.
**Date:** 2026-09-01

## Delivered read model

`GET /api/v1/workforce/exception-reports` is intentionally separate from the
approved-timesheet report. It is protected by the existing C7 exception-queue
authorization boundary: before the granular-access flag it preserves the
session-administrator boundary; after it, a caller needs an effective
organization-scoped `HR_ADMIN` / `TEAM_EXCEPTION_READ` grant. It does not
reuse `TEAM_ATTENDANCE_READ`, infer a mutable current team, or restore a CRM
administrator fallback.

The route takes an optional tenant-timezone date range of at most 93 days. On
the initial request it uses the server-selected trailing 14 tenant-local days,
then the UI displays that exact range and timezone before a user applies a
different date-only range. The filter is explicitly the **case recorded date**
(`WorkforceExceptionCase.createdAt`), not a claimed work start, physical
presence date or absence decision.

It reads only the bounded append-only case envelope fields needed for an
aggregate:

- internal employee reference, used only to count distinct employees;
- generic approved exception type;
- append-only generic decision codes, used only to derive the documented
  review stage; and
- existence of one employee-response record, used only as a receipt count.

The browser receives aggregate counts by type and derived review stage. It
does not receive employee names or identifiers, case references, workday/site/
segment/evidence references, exact timestamps, location, QR, device data,
response content/links, decision reasons or raw proof. The access audit holds
only the date window and aggregate counts. An unknown type prevents the report
with a conflict; an unknown or contradictory decision history is represented
as `DATA_INTEGRITY_REVIEW`, never resolved. The relation read is capped at 64
decisions plus a sentinel; a longer history is also retained for
`DATA_INTEGRITY_REVIEW` rather than deriving a terminal state from a truncated
ledger. A missing C6 table/query is an explicit
`WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE` result and a result above 5,000 cases
is an explicit 413; neither becomes a zero-count report.

`/workforce/exceptions/report` is a distinct responsive, EN/RU/AZ aggregate
surface linked from the detailed, already-authorized exception queue. It
provides server-initialized date inputs and summary/type-stage tables. Its
boundary explicitly says that counts are neither proof of physical presence
nor an absence, payroll or disciplinary conclusion.

## Explicit non-claims

- This is a report of **persisted** review cases only. It does not declare a
  no-show for a missing workday and does not activate a detector.
- It does not add a tenant exception policy, SLA, automated resolution,
  payment, disciplinary action, notification or physical-evidence viewer.
- It does not complete C6 lifecycle activation, C7 grant rollout, migration
  apply/RLS proof, browser E2E, staging reconciliation or real-device/pilot
  verification.

## Verification

```text
PASS  CI=true npx vitest run --maxWorkers=1
      workforce-exception-case-report,
      api-workforce-exception-reports,
      lib-workforce-exception-queue,
      api-workforce-exceptions
      (4 files, 14 tests)
PASS  targeted ESLint for the aggregate builder/route/tests and later for the
      report page/components; git diff --check
PASS  npm run i18n:check (21,498 EN leaf keys; RU/AZ parity)
NOT RUN  browser E2E, full TypeScript check, production build, migration
         apply/disposable-DB RLS exercise, staging reconciliation, load,
         physical devices and pilot. These heavy/external gates are not run on
         the Contabo development host.
```
