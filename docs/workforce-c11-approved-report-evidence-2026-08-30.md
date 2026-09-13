# Workforce C11 approved report evidence

**Status:** WF-C11-007 partial — approved-time reporting is available; the
schedule-aware no-show and site-transition report lanes remain deliberately
unavailable.
**Last verified:** 2026-09-13

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
Every stored metric and aggregate must remain a non-negative safe integer;
hash-valid but malformed negative or overflowing data fails closed rather than
reaching the report response.

The report response and its access audit deliberately exclude raw coordinates,
QR tokens/nonces, device keys/proofs, request reasons, individual approval row
hashes and other free text. The access audit has period and aggregate counts
only; it does not store employee identifiers or individual metrics.
Every success and failure response is private/no-store and nosniff. Expected
authorization or immutable-integrity failures expose fixed codes only;
unexpected report/access failures emit only a fixed operation label, never an
error object, employee value or approval detail.

A distributed tenant-and-principal budget limits the endpoint to 30 report
requests per 15 minutes. The Redis partition tag contains a one-way tenant
hash rather than a tenant or employee identifier. Limiter unavailability fails
closed before actor resolution, access lookup, approval reads or audit writes;
bounded `Retry-After` responses remain private/no-store.

The new Workforce web report uses this endpoint, a date filter and the current
actor scope. Its first load omits the date parameters so the server selects
the period in the tenant timezone; the inputs are then updated to the exact
returned start/end dates and name that timezone. A browser in a different
timezone therefore cannot silently choose a different Baku work date on the
initial report. Later explicit date-filter submissions remain user-selected.
If a replacement filter request supersedes an earlier browser request, only
the live request can clear the loading state; an aborted response cannot
re-enable controls while another approved period is still loading.
It is a separate HRM navigation item and remains independent of Route & Field.
The browser allowlist-parses the source, tenant timezone, fixed unavailable
lanes and every non-negative metric. It rejects unknown rows, duplicate
employees and any response whose employee totals do not reconcile to the
summary, rather than rendering a partial or internally inconsistent report.

The existing separate exception aggregate remains behind its exception-queue
authorization boundary. This slice also aligns every exception-report response
with the same private/no-store and nosniff headers and replaces raw exception
logging with a fixed operation label.

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

- **PASS:** seven sequential targeted Vitest files, 89 tests: report
  service/API/rate limiter, browser response contract, immutable export,
  approval service and navigation. Coverage includes the pre-read limiter
  short-circuit, fail-closed limiter path, hash-valid negative metrics and
  aggregate-overflow rejection.
- **PASS:** exception report/API Vitest, 2 files and 7 tests; includes private
  failure responses and fixed-label error logging.
- **PASS:** targeted ESLint for the report service, route, access guard,
  component and tests.
- **PASS:** `npm run i18n:check`: 22,520 EN leaf keys; RU/AZ missing=0,
  extra=0.
- **PASS:** `git diff --check`.
- **NOT RUN:** full TypeScript check, production build, browser E2E, staging
  data reconciliation and load tests; full/heavy gates are reserved for CI or
  an approved heavy worker, not the Contabo development host.
