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

The draft is React client state, not a persisted operational object. Editing an
employee, shift or date clears the existing result. **Discard local draft**
clears all values. The only request is the existing session-admin,
tenant-scoped `POST /api/v1/workforce/configuration/assignments/preview`.
There is no bulk assignment endpoint, no publish action, no audit write and no
change to current or historical schedules.

## Verification in this worktree

- PASS — targeted Vitest: `workforce-configuration-management`, API
  configuration and assignment UI contract: **3 files, 40 tests**.
- PASS — targeted ESLint for the changed component and UI contract test.
- PASS — `npm run i18n:check`; AZ/RU/EN parity is complete.
- PASS — `git diff --check`.

## Deliberately still open

- `WF-C7-007` remains partial: bulk site assignment, durable reviewed draft,
  idempotent publish/confirmation, recurring schedule/template semantics and
  browser evidence are not claimed.
- NOT RUN — browser, full build, Android and load gates. They require the
  approved heavy worker/CI, not Contabo.

This slice is safe to expose as a review aid because it cannot mutate a
schedule; a later publish workflow must re-preview inside its transaction and
record its durable result/audit boundary before it can be enabled.
