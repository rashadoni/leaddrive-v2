# Workforce C3 — bulk shift assignment preview evidence

**Task:** `WF-C3-009`
**Checkpoint:** pending commit on `codex/implement-hrm-plan`
**Status:** PARTIAL (safe read-only slice)

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
write. That is intentional: a mass apply, temporary cover and recurring
schedule contract still require a durable idempotency/result record, an
immediate re-preview/confirmation rule and HR product semantics. The endpoint
is therefore not an authorization token and cannot silently change schedules.

## Verification run in this worktree

- PASS — targeted Vitest: Workforce configuration management/API, shift
  resolution and schedule snapshot: **4 files, 48 tests**.
- PASS — targeted ESLint and `git diff --check`.

## Explicitly not run

- NOT RUN — browser evidence for an assignment-review screen: no visible bulk
  apply UI was added in this safe server slice.
- NOT RUN — full build/browser E2E/Android/load checks: heavy gates belong to
  CI or an approved worker.

## Remaining work

The C3-009 task remains partial. A future apply must be separately designed as
an audited idempotent operation; temporary cover and recurring templates cannot
be inferred from a one-off assignment without approved workforce semantics.
