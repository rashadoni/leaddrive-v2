# Workforce C7 — reversible bulk schedule draft evidence

**Task:** `WF-C7-007`
**Status:** PARTIAL — safe schedule-review slice only

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
clears all values. The only request is the existing session-admin,
tenant-scoped `POST /api/v1/workforce/configuration/assignments/preview`.
There is no bulk assignment endpoint, no publish action, no audit write and no
change to current or historical schedules.

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

## Verification in this worktree

- PASS — targeted Vitest: `workforce-configuration-management`, API
  configuration and assignment UI contract: **3 files, 40 tests**.
- PASS — targeted ESLint for the changed component and UI contract test.
- PASS — `npm run i18n:check`; AZ/RU/EN parity is complete.
- PASS — `git diff --check`.
- PASS — targeted site-management/API/UI/accessibility tests: **4 files, 30
  tests**, including the no-prior-assignment, conflict and
  unavailable-employee preview paths.

## Deliberately still open

- `WF-C7-007` remains partial: durable reviewed draft, idempotent
  publish/confirmation, recurring schedule/template semantics and browser
  evidence are not claimed.
- NOT RUN — browser, full build, Android and load gates. They require the
  approved heavy worker/CI, not Contabo.

This slice is safe to expose as a review aid because it cannot mutate a
schedule; a later publish workflow must re-preview inside its transaction and
record its durable result/audit boundary before it can be enabled.
