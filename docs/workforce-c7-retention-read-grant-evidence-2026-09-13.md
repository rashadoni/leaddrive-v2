# Workforce C7 retention dry-run grant evidence

Date: 2026-09-13

Roadmap item: `WF-C7-002` (partial)

Scope: bounded raw-location retention inventory only

## Delivered boundary

- The raw-location retention endpoint remains session-only and MFA-protected.
- Before granular-access cutover, the established tenant-admin behavior is
  unchanged.
- After cutover, the endpoint requires an effective organization-scoped
  `RETENTION_HOLD_OFFICER` grant carrying `RETENTION_DRY_RUN_READ`.
- A broad CRM admin role is not a fallback after cutover, while a deliberately
  granted non-admin principal can perform the dry run.
- The endpoint still exposes only a bounded dry run and counts-only audit. It
  cannot execute deletion, change a legal hold, or expose raw coordinates.
- Authorization failures are fail-closed and use private, no-store response
  headers for the sensitive boundary.

## Verification

- PASS: 3 focused Vitest files / 31 tests, sequential single-worker run.
- PASS: scoped ESLint for the route, wrapper, scanner and focused tests.
- PASS: `python3 scripts/rls/find-context-gaps.py` (`RLS-CONTEXT GAPS: 0`).
- PASS: `git diff --check`.
- NOT RUN: full build, full browser E2E and Android; this narrow server access
  slice does not justify a heavy Contabo run and those gates remain assigned to
  GitHub CI or an approved heavy worker.

## Explicit exclusions

No grant, rollout flag, retention execution path, legal-hold mutation, tenant
activation or production data change is introduced. Initial custody, live
access review and disposable-database/RLS exercise remain open roadmap work.
