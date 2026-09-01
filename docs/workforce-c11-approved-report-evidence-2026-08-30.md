# Workforce C11 approved report evidence

**Status:** WF-C11-007 partial — approved-time reporting is available; the
schedule-aware no-show and site-transition report lanes remain deliberately
unavailable.
**Date:** 2026-08-30

## Delivered read model

`GET /api/v1/workforce/reports` is a human-session, Workforce-capability and
actor-scope-gated endpoint. It accepts a bounded 93-day date range and an
optional in-scope employee filter. It reads only immutable
`WorkforceTimesheetApproval` rows, rebuilds their hashes before every metric,
and rejects the entire report if even one selected approval cannot reproduce.

After a tenant explicitly enables C7 granular access, the same read requires
an effective `TEAM_ATTENDANCE_READ` grant. A selected employee is matched only
against an exact employee scope; an all-scope aggregate requires an
organization scope because immutable approval rows do not contain a historic
team/site snapshot. The endpoint therefore never uses a present-day team to
broaden a historical report, and an ungranted CRM administrator has no
fallback. Before the flag, the existing session-administrator boundary stays
unchanged.

The aggregate and employee breakdown include approved workdays, expected and
actual time, recorded pause time, late start, undertime, operational overtime
and long-pause deviations. Overlapping approval views are deduplicated by
workday: the latest immutable approval/correction wins, and the suppressed
overlap count is disclosed. This prevents a correction revision or an
overlapping manager view from being counted twice.

The report response and its access audit deliberately exclude raw coordinates,
QR tokens/nonces, device keys/proofs, request reasons, individual approval row
hashes and other free text. The access audit has period and aggregate counts
only; it does not store employee identifiers or individual metrics.

The new Workforce web report uses this endpoint, a date filter and the current
actor scope. It is a separate HRM navigation item and remains independent of
Route & Field.

## Explicit non-claims

- No-show remains unavailable until C6 has an approved, schedule-aware
  exception lifecycle. A missing workday is never manufactured as absence.
- Site/branch-transition reporting remains unavailable from ordinary approved
  time facts because those facts intentionally exclude presence/location
  claims. It must be built from C2/C6-approved evidence rules.
- This is an operational-time report, not payroll. Overtime remains a
  non-payable operational deviation.
- It does not replace restricted evidence access, purpose-based export
  delivery, legal notice or a physical/browser acceptance run.

## Verification

```text
PASS  npx vitest run workforce-approved-timesheet-report,
      api-workforce-reports, workforce-timesheet-export,
      workforce-timesheet-approval-service, nav-items
      (5 files, 71 tests; one sequential Vitest worker)
PASS  targeted ESLint for report service, route, component, page and tests
PASS  npm run i18n:check (21,232 EN leaf keys; RU/AZ missing=0, extra=0)
PASS  git diff --check
PASS  2026-09-01: selected-employee grant/no-fallback and unavailable-grant
      source contracts (9 tests across report/access evaluator)
NOT RUN  full TypeScript check, production build, browser E2E, staging data
         reconciliation and load tests: full/heavy gates are reserved for CI
         or an approved heavy worker on this Contabo development host.
```
