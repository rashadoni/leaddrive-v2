# Workforce C7 — Today granular read fence

**Task:** `WF-C7-002` partial

**Recorded:** 2026-09-01

## Delivered source boundary

After `workforce-granular-access-v1`, the current-day Workforce read model
does not return employee names, workday status, calendar state, schedule
snapshots or transition claims until it resolves an explicit persisted access
decision.

- The preliminary query contains only current active employee `id` and
  `teamId`; no person names, worktime, calendar, location or proof are read
  before authorization.
- An employee keeps only their own current-day row through
  `SELF_WORKTIME_READ`.
- `TEAM_ATTENDANCE_READ` can admit organization, exact-agent and current-team
  scope from one bounded persisted-grant snapshot. It does not issue one grant
  query per employee.
- A site grant is deliberately not translated from a mutable schedule or a
  presence claim. It fails closed until a separately reviewed current-site
  resolver exists.
- During this incremental rollout the pre-existing Workforce actor scope is a
  stricter roster ceiling, not an authorization fallback: without an effective
  Workforce grant (or the exact self permission), it produces the same generic
  denial.

Before the explicit tenant flag, the established session/actor scope is
unchanged. The endpoint remains a human-session read; it creates no grant,
changes no flag and writes no time or attendance fact.

## Verification

```text
PASS  CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run --maxWorkers=1 \\
      src/__tests__/lib-workforce-today-read-access.test.ts \\
      src/__tests__/api-workforce.test.ts \\
      src/__tests__/api-workforce-today-self-actions.test.ts \\
      src/__tests__/workforce-today-web-fallback-ui-contract.test.ts \\
      src/__tests__/workforce-timesheet-detail-ui-contract.test.ts \\
      src/__tests__/lib-workforce-access-control.test.ts \\
      src/__tests__/lib-workforce-access-grant-resolution.test.ts \\
      src/__tests__/with-workforce-rls-auth.test.ts
      (8 files, 77 tests)

PASS  scoped ESLint; git diff --check
PASS  python3 scripts/rls/find-context-gaps.py
      (529 organization-scoped models; 0 gaps)

NOT RUN  full TypeScript/build, browser E2E, Android, applied RLS, isolated
         staging and physical attendance checks. Exact CI remains externally
         blocked and Contabo policy prohibits the heavy/physical gates locally.
```
