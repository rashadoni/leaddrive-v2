# WF-C8-007b future organization calendar configuration evidence — 2026-09-29

## Claim boundary

This slice adds bounded, forward-only authoring for one organization-wide
Workforce calendar override. It does not complete `WF-C8-007` and does not
change the roadmap or production-readiness gate count.

Included:

- session-only `SCHEDULE_READ` and `SCHEDULE_WRITE` authorization through the
  granular Workforce schedule-configuration boundary;
- a 1–367 day future list with an explicit organization predicate and only
  active organization-scope rows;
- strict create input containing only a real `YYYY-MM-DD` date, one released
  kind and a non-empty bounded name;
- organization-local server date derived from the tenant timezone, with UTC
  fallback for an invalid stored timezone;
- one additive transaction protected by a tenant/date advisory lock and the
  existing partial unique index;
- state-idempotent exact replay and a fail-closed conflict for a different row
  on the same date;
- an actor-attributed audit row in the same transaction as the calendar row;
- a separate localized Scheduler-visible UI with named controls, inline
  status/error output, responsive layout and 44 px minimum controls.

Excluded:

- update, delete, rollback, past/today authoring or historical repair;
- team, employee, leave or moved-day pair authoring;
- proof-policy, version-diff or break-policy authoring;
- schema/migration changes and any Route UI or Route API change;
- browser/AT/contrast/zoom/device acceptance, Android/Gradle, load, signed
  device and tenant-pilot evidence.

## Shared-ledger safety

`MtmWorkCalendarDay.source` is a free string with the established `ADMIN`
default; there is no governed `WORKFORCE_CONFIG` enum or contract. The writer
therefore persists `source: "ADMIN"` and records Workforce provenance in the
atomic `WORKFORCE_CALENDAR_OVERRIDE_CREATED` audit action and
`workforce_calendar_configuration` metadata kind. It does not invent an
unreviewed source value.

The retained calendar ledger is also read by Route. To avoid silently changing
Route planning eligibility, the writer persists `routePlanningAllowed` from
the no-override weekday/weekend baseline for that date. A weekday HR holiday
therefore keeps the prior weekday Route-planning allowance; a weekend HR
exception workday keeps the prior weekend disallowance. Workforce attendance
resolution continues to derive its expectation from the calendar kind and
deliberately ignores this Route flag.

## Data and API contract

- `GET /api/v1/workforce/configuration/calendar` returns only
  `timezone`, `currentDate`, `start`, `endExclusive` and ordered
  `{date, kind, name}` summaries. Storage IDs, scope IDs, source, actors and
  Route flags are absent.
- The query always applies `organizationId`, `teamId: null`, `agentId: null`
  and `deletedAt: null`, plus a bounded half-open date range.
- `POST /api/v1/workforce/configuration/calendar` accepts only
  `{date, kind, name}`. Released create kinds are `PUBLIC_HOLIDAY`,
  `COMPANY_HOLIDAY` and `EXCEPTION_WORKDAY`.
- The date must be strictly later than the server-derived organization date.
  Caller-provided IDs, scope, moved dates, source or planning flags fail strict
  parsing.
- The transaction takes an advisory lock on organization/date, re-reads the
  active organization row, returns HTTP 200 for the exact desired state,
  creates once with HTTP 201, and returns 409 for a differing or concurrent
  row. Audit failure aborts the transaction instead of leaving an unaudited
  success.

## Verification on the implementation tree

PASS:

- `npx vitest run` on the three new calendar test files plus the existing
  Workforce and retained-calendar domain suites: 5 files / 28 tests;
- `npx vitest run src/__tests__/rls-route-context-coverage.test.ts`: 1 file /
  3 tests;
- scoped ESLint on all eight changed TS/TSX implementation and test paths;
- `npm run i18n:check`: EN source 23,831 leaf keys, RU/AZ missing 0 and extra 0;
- `git diff --check` and repository JSON parsing through the i18n checker.

The first focused test execution exposed two test-only assertion defects: the
test setup cleared import-time wrapper evidence, and a broad `/id/i` regex
matched the word `HOLIDAY`. Both assertions were narrowed; no production code
was changed for those failures, and the complete focused set then passed.

NOT RUN under the Contabo workload contract:

- full repository TypeScript check, production build and full test suite;
- real browser, assistive-technology, contrast, zoom and device acceptance;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

These remain CI/authorized-worker responsibilities. Exact-head CI and a fresh
author-independent review are required before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`. Organization-wide future create/list authoring
is now implemented in source, but team/employee and moved-day workflows,
update/delete governance, break-policy authoring and real browser/AT evidence
remain outside this slice. Progress remains `DONE 81/161`, `GATES 14/15`, C8
36%, overall 59%, with 80 non-DONE rows.
