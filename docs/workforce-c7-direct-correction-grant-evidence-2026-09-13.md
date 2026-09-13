# Workforce C7 direct correction grant evidence

Date: 2026-09-13

Scope: partial `WF-C7-002` migration of direct closed-workday corrections to
explicit Workforce authority.

## Accepted behavior

- The API remains an MFA-protected, rate-limited, human-session-only action.
- Before granular cutover, the established manager/admin actor scope remains
  authoritative. After cutover, an effective `TIME_APPROVER` grant with
  `TIME_CORRECT` permission must cover the exact workday employee.
- A deliberately granted principal does not need a legacy CRM/MTM actor row;
  an unrelated employee actor cannot suppress the separate grant.
- The target employee remains unable to correct their own workday through both
  actor-ID and linked-user checks, including the locked re-read.
- Successful audit metadata records whether authority came from the legacy
  actor or `WORKFORCE_GRANT`; grant reasons and identifiers are not copied.
- Existing immutable correction, optimistic concurrency, replay validation,
  idempotency and atomic audit behavior are unchanged.

No grant or tenant rollout flag is created by this slice, and Route & Field is
not read or mutated.

## Verification

- Targeted Vitest passed 2 files / 31 tests, including grant-only correction,
  cutover denial without a grant, independent employee actor plus grant,
  no-actor route delegation and all existing correction security guards.
- Scoped ESLint and `git diff --check` passed.
- Full build, browser E2E, Android, disposable-database RLS and production smoke
  are **NOT RUN locally** on Contabo; applicable heavy gates remain CI-owned.
