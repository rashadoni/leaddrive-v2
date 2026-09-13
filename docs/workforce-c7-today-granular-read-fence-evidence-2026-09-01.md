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
PASS  focused Vitest for Today access, Timesheet access and shared API routes
      (3 files / 31 tests) in this exact tree
PASS  scoped ESLint; git diff --check

NOT RUN  full TypeScript/build, recursive RLS scan, browser E2E, Android,
         applied RLS, isolated staging and physical attendance checks. Contabo
         policy prohibits the heavy/physical gates locally; the applicable
         compile/static checks run on the reviewable GitHub PR.
```
