# Workforce C7 — reversible bulk schedule draft evidence

**Task:** `WF-C7-007`
**Status:** PARTIAL — safe schedule/site review plus durable future publish source slices

## Delivered

The HR configuration workbench has a named, tenant-scoped draft review for up
to 200 active employees. An HR administrator selects a published shift and a
future effective date, then receives a server-derived outcome for every selected
employee plus counts for:

- ready future operation;
- already covered by the selected shift;
- unavailable employee;
- team mismatch; and
- a conflicting future assignment.

Only this concise count summary is announced to assistive technology. The
individual outcomes are a semantic list outside the live region, so selecting
200 employees does not enqueue 200 names for speech.

The draft is React client state, not a persisted operational object. Editing an
employee, shift or date clears the existing result. **Discard local draft**
clears all values. The first request is the existing session-admin,
tenant-scoped `POST /api/v1/workforce/configuration/assignments/preview`.

The same read contract and browser-only discardable draft now exist for future
site eligibility:
`POST /api/v1/workforce/configuration/site-assignments/preview`. It accepts up
to 200 named employees plus one active site, kind and effective window. Its
per-employee result is `READY`, `NO_CHANGE`, `EMPLOYEE_UNAVAILABLE` or
`CONFLICT`, matching the forward-only primary/secondary/temporary timeline
rules. It reads active employees, the selected site and matching assignment
history in bulk; it never opens a transaction, acquires a lock, writes an
assignment or writes an audit entry. The web draft uses the same named employee
selection, clears its result after any site/kind/window/employee change and
announces only the outcome counts. A site preview can never change Route,
attendance history or employee site eligibility.

## Durable bulk site publish source slice (2026-09-01)

The workbench now offers a separate explicit confirmation only after a fresh
site preview has zero `CONFLICT` and `EMPLOYEE_UNAVAILABLE` results and at
least one `READY` employee. The confirmation sends a client-generated opaque
operation key to:

`POST /api/v1/workforce/configuration/site-assignments/bulk/publish`

The endpoint uses the existing Workforce-only `SITE_ASSIGNMENT_WRITE`
permission. The server does not trust the browser preview: one transaction
first locks the tenant operation key, then locks every employee's matching
site-assignment timeline in sorted order, recomputes the preview, and refuses
the entire request if any employee is no longer active or any future conflict
appears. Only then it closes open primary predecessors and appends every ready
future assignment. There is no partial publish result.

The additive `workforce_site_assignment_bulk_operations` receipt is unique by
tenant/operation key, hash-bound to the actor and sorted input, append-only and
RLS-protected. It deliberately retains only site/window/kind, actor and
aggregate requested/created/unchanged counts. It stores no employee selection
list, GPS, QR, device proof or Route data. Its one configuration audit entry
has the same aggregate-only boundary. An exact replay returns the stored
counts; a changed payload under the same operation key is rejected.

This is a future site-eligibility writer only. It neither publishes bulk shift
templates nor recurring schedules, changes attendance facts, opens a workday,
calculates travel/payroll, or mutates Route & Field.

## Durable bulk shift publish source slice (2026-09-01)

The same explicit-confirmation boundary now exists for a reviewed bulk shift
assignment. The confirmation is available only after the current preview has
zero `CONFLICT`, `EMPLOYEE_UNAVAILABLE` and `TEMPLATE_TEAM_MISMATCH` outcomes,
and at least one `READY` employee. It sends an opaque browser operation key to:

`POST /api/v1/workforce/configuration/assignments/bulk/publish`

The route uses the existing Workforce-only `SCHEDULE_WRITE` permission. It
does not trust the browser review: in one transaction the server first locks
the operation key, then locks each selected employee's existing shift-timeline
namespace in sorted order, recalculates the preview, and refuses the full
publish if availability, team scope or a future conflict changed. It closes
only the exact predecessor for each ready employee and appends the selected
already-active template at the future date. There is no partial response.

`workforce_shift_assignment_bulk_operations` is an additive append-only,
tenant-RLS receipt, unique by tenant/operation key and hash-bound to actor,
template, date and sorted selection. It retains only template/date, actor and
aggregate requested/created/unchanged counts; it contains no employee list,
location, QR, device evidence or Route data. The matching audit row has the
same aggregate-only boundary. An exact retry returns the stored result, while
any changed payload reusing the operation key is rejected.

This source slice only publishes a future assignment to an existing active
template. It does not create a recurring template, alter existing workdays or
snapshots, open attendance, calculate payroll/travel, activate a tenant flag,
or mutate Route & Field.

## Verification in this worktree

- PASS — targeted Vitest: `workforce-configuration-management`, API
  configuration and assignment UI contract: **3 files, 40 tests**.
- PASS — targeted ESLint for the changed component and UI contract test.
- PASS — `npm run i18n:check`; AZ/RU/EN parity is complete.
- PASS — `git diff --check`.
- PASS — targeted site-management/API/UI/accessibility tests: **4 files, 30
  tests**, including the no-prior-assignment, conflict and
  unavailable-employee preview paths.
- PASS — targeted bulk-publish Vitest contracts: **5 files, 35 tests**. They
  cover atomic two-employee publish, exact replay without a second assignment
  or audit, stale-review refusal before every write, RLS/append-only migration
  shape, API tenant scope and explicit web confirmation.
- PASS — `DATABASE_URL=<non-secret placeholder> npx prisma validate`.
- PASS — scoped ESLint and `git diff --check`.
- PASS — bulk shift publish contracts: configuration service, session route,
  append-only/RLS migration shape and UI confirmation: **4 files, 48 tests**.
  They cover atomic publish, aggregate-only receipt/audit, exact replay,
  stale-review refusal, session scope and operation-key retry containment.

## Deliberately still open

- `WF-C7-007` remains partial: recurring-template/recurrence publication,
  browser evidence and applied migration/RLS concurrency are not claimed.
- NOT RUN — local Prisma generated-client refresh did not update the shared
  Contabo artifacts despite a zero-exit command; exact generated-client/static
  verification, full build, browser, Android and load gates require GitHub CI
  or the approved heavy worker, not Contabo.

Both publish source slices remain inactive until the additive migrations, RLS
concurrency and browser/role checks are verified through the approved release
gates. No tenant schedule was changed by this implementation checkpoint.
