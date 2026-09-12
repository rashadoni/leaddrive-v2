# Workforce C3 — bulk shift assignment preview evidence

**Task:** `WF-C3-009`
**Checkpoint:** recorded on `codex/implement-hrm-plan`
**Status:** PARTIAL (safe read-only server and web slice)

## Delivered contract

`POST /api/v1/workforce/configuration/assignments/preview` is a session-admin,
tenant-scoped read-only endpoint for up to 200 selected employees. For one
future effective date and published template it returns an ordered per-employee
outcome:

- `READY`, including the predecessor that a future apply would close;
- `NO_CHANGE` when the same template already covers the date;
- `EMPLOYEE_UNAVAILABLE`, `TEMPLATE_TEAM_MISMATCH`, or `CONFLICT`.

The preview validates the organization-local future-date boundary and reports
summary counts. It performs no advisory lock, assignment insert/update or audit
write. The Workforce configuration web workbench exposes this as a named,
up-to-200 employee browser-only draft: changing an employee, shift or date
clears the result, and **Discard local draft** removes every client-side value.
The outcome list names each employee and reports `READY`, `NO_CHANGE`,
`EMPLOYEE_UNAVAILABLE`, `TEMPLATE_TEAM_MISMATCH` or `CONFLICT`; it does not
expose opaque predecessor IDs.

There is deliberately no mass-write route or publish control. A mass apply,
temporary cover and recurring schedule contract still require a durable
idempotency/result record, an immediate re-preview/confirmation rule and HR
product semantics. The endpoint and its UI are therefore not authorization to
mutate a schedule and cannot silently change schedules.

## Verification run in this worktree

- PASS — targeted Vitest: Workforce configuration management/API and visible
  assignment contract: **3 files, 40 tests**.
- PASS — targeted ESLint and `git diff --check`.
- PASS — `npm run i18n:check` with complete English, Azerbaijani and Russian
  copy.

## Explicitly not run

- NOT RUN — browser evidence: the review interface is implemented but no
  browser session was run on Contabo.
- NOT RUN — full build/browser E2E/Android/load checks: heavy gates belong to
  CI or an approved worker.

## Remaining work

The C3-009 task remains partial. A future apply must be separately designed as
an audited idempotent operation; temporary cover and recurring templates cannot
be inferred from a one-off assignment without approved workforce semantics.
