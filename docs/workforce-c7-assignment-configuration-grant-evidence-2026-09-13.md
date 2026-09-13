# Workforce C7 assignment configuration grant evidence

Date: 2026-09-13

Scope: partial `WF-C7-002` migration of effective-dated shift assignment
configuration to explicit scheduler authority.

## Accepted behavior

- Named assignment timeline/search and the read-only bulk conflict preview
  require `SCHEDULE_READ`.
- Scheduling a future employee shift assignment requires `SCHEDULE_WRITE`.
- All paths remain human-session-only and tenant/RLS scoped. Before granular
  cutover, the established tenant-admin rule is preserved; after cutover, only
  the effective persisted Workforce grant is authoritative.
- The preview remains read-only, bounded and conflict-reporting. This change
  does not publish a draft, create an assignment, issue a grant or activate a
  tenant flag.
- Shift assignments remain Workforce-owned and do not depend on Route & Field.

## Verification

- Targeted Vitest passed 2 files / 33 tests. The route-construction contract
  now accounts for all 12 schedule-bound handlers and the shared authorization
  tests cover the legacy and granular cutover behavior.
- Scoped ESLint and `git diff --check` passed.
- Full build, browser E2E, Android, disposable-database RLS and production smoke
  are **NOT RUN locally** on Contabo; applicable heavy gates remain CI-owned.
