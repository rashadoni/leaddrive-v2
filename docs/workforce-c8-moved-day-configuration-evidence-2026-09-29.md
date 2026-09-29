# WF-C8-007e atomic moved-day configuration evidence — 2026-09-29

## Claim boundary

This slice adds forward-only atomic workday moves to the released Workforce
calendar configuration surface. It does not complete `WF-C8-007`, change a
roadmap row to `DONE`, or add a production-readiness gate.

Included:

- strict `MOVE_WORKDAY` create for `ORGANIZATION` and one named active `TEAM`;
- two distinct future dates inside the existing 367-day calendar window;
- one reciprocal `MOVED_DAY_OFF` / `MOVED_WORKDAY` pair, one transaction and
  one pair-level audit;
- exact-pair retry, conflict behavior and deterministic dual-date locks;
- minimized future inventory with a reciprocal paired date;
- explicit fences preventing the legacy MTM PUT/DELETE endpoints from
  creating, converting or independently deleting moved rows;
- localized EN/RU/AZ web controls and updated voice guidance.

Excluded:

- `AGENT` moved days, because request approval can replace a personal
  calendar row and would orphan the other half of a pair;
- update, reversal, delete, repair/backfill and bulk moved-day operations;
- today/past edits, schema or migration changes, Route mutations and
  break-policy authoring;
- browser/AT/contrast/zoom/device acceptance, Android/Gradle, load/chaos,
  signed-device and tenant-pilot evidence.

## Request, target and response contract

`POST /api/v1/workforce/configuration/calendar` now accepts a strict union.
The existing holiday/closure/exception create contract is unchanged. The new
branch requires `operation: "MOVE_WORKDAY"`, exact organization or team scope,
two real distinct dates and a trimmed 1–160-character non-sensitive display
label. Unknown fields, mixed targets, employee scope and internal storage
fields are rejected. The domain writer repeats the organization/team scope
guard so a future internal caller cannot cast an employee draft into an
organization write.

Team scope revalidates and row-locks an active team inside the authenticated
tenant. The list response remains minimized to date, readable kind, display
label and optional paired date. It does not expose row IDs, source, actors,
Route values or audit data.

## Atomicity, precedence and idempotency

Both tenant/date advisory keys are de-duplicated and sorted before either is
acquired. The same lock primitive is used by the existing one-date Workforce
writer. After both locks, team scope takes `FOR SHARE OF team`, then reads only
the target and organization candidates for the two dates.

The source must be an effective HR working day and the destination an
effective HR non-working day under organization/team/default precedence. Each
date independently freezes its already-resolved `routePlanningAllowed`
baseline. The HR move therefore does not silently enable or disable Route
planning.

Creation writes both rows and one `WORKFORCE_CALENDAR_MOVED_DAY_CREATED` audit
inside one Prisma transaction. A failed second insert or audit rolls the first
row back. A database unique collision maps to the same 409 conflict contract.

Only a complete reciprocal `ADMIN` pair with matching scope, dates, kinds,
label, reciprocal links and two non-null server-owned Route baselines is an
exact no-op retry. The frozen Route values are not recomputed on retry because
parent calendar state can legitimately change after the original write.
Partial, mismatched, foreign-provenance, nullable-baseline or occupied state
fails closed and is never repaired implicitly.

## Legacy mutation fence

The legacy `/api/v1/mtm/work-calendar` reader remains available. Its PUT now
returns `409 MTM_CALENDAR_MOVED_PAIR_REQUIRED` before target lookup or mutation
for either internal moved kind or any supplied moved destination. It also
refuses to convert an existing moved row through an ordinary update. Legacy
DELETE returns the same 409 before soft deletion, so one half cannot be
removed independently. Malformed moved input still fails schema validation.

## UI and accessibility source contract

The calendar form offers one explicit “Move workday” operation only for
organization/team scope; internal moved kinds are never selectable. Source
and destination are separate native date inputs with described HR/Route
semantics, the shared label discloses schedule visibility and audit retention,
and the submit action is disabled for equal or missing dates. Switching to
employee scope resets the operation to ordinary override creation.

All ten possible selection/search/draft controls freeze during mutation and
reconciliation. Existing latest-request fencing and honest unknown-outcome
copy remain intact. Inventory renders the reciprocal date without exposing
storage identity. Touch targets remain at least 44 px and the form collapses
from four columns to the existing responsive single-column layout.

## Real PostgreSQL CI proof

`lib-workforce-calendar-configuration-lock-postgres.test.ts` is wired into
both `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml` on the
existing PostgreSQL 16 service.

The first proof pauses transaction A after its first real advisory lock, starts
a reversed-date transaction B, observes B in PostgreSQL's advisory-lock wait,
then releases A. Correct sorting lets both finish. Removing sorting makes the
transactions own opposite first keys and produces a real deadlock, so the gate
fails rather than relying on a short negative timer.

The second proof uses a unique temporary schema and two real Prisma clients.
Concurrent exact writer retries must produce exactly two reciprocal rows, one
creation result, one replay result and one audit. A reversed pair then fails
with the occupied-state conflict, and the database must still contain two rows
and one audit. The schema is dropped after the test.

## Author verification

PASS on the current implementation tree:

- 11 focused calendar/domain/API/UI/auth/RLS/voice files: 116 tests passed;
- the two real-PostgreSQL tests were discovered and skipped locally because
  the CI-only database URL is intentionally absent;
- scoped ESLint on all changed TypeScript/TSX implementation and test paths;
- `npm run i18n:check`: EN source 23,905 leaf keys, RU/AZ missing 0 and extra
  0;
- event-platform workflow asset validation and runner policy validation;
- JSON parsing through translation parity and `git diff --check`.

NOT RUN under the Contabo workload-placement contract:

- the real PostgreSQL gate (mandatory in exact-head PR CI and deploy CI);
- full repository typecheck, production build and full test suite;
- browser, assistive-technology, contrast, zoom and physical-device checks;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

Exact-head GitHub CI and a fresh author-independent full-range frozen review
remain mandatory before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`: ordered segments and future
organization/team/employee override creation plus organization/team moved-day
create/list are source-complete. Moved-day reversal/delete governance,
general update/delete governance, break-policy authoring and real browser/AT
acceptance remain open. Progress stays `DONE 81/161`, `GATES 14/15`, C8 36%,
overall 59%, with 80 non-DONE rows. No completion or gate credit is claimed by
this checkpoint.

## Live-main reconciliation

The implementation checkpoint `b11798b93` was merged with live `origin/main`
`8c8ca4360285dec692caf7784d805936c276ae1e`. Main contributed only five Social
Monitoring source/test/evidence paths. No calendar implementation, workflow,
locale, test or evidence path overlapped, and the merge completed without a
manual resolution.

On the integrated head, the same 11 focused files pass 116 tests with both
real-PostgreSQL cases discovered and skipped locally, scoped ESLint passes,
i18n remains EN 23,905 with RU/AZ 0/0, event-platform workflow assets and
runner policy pass, and `git diff --check` is clean. The fresh independent
review must use this post-reconciliation head and the live-main merge base.
