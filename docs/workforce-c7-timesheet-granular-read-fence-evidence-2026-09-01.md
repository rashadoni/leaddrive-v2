# Workforce C7 — Timesheet granular read fence

**Task:** `WF-C7-002` partial

**Recorded:** 2026-09-01

## Delivered source boundary

After `workforce-granular-access-v1`, the Workforce timesheet checks an
explicit persisted access decision before it loads the named employee roster
or any workday facts.

- An employee may read only a selected timesheet for their own exact agent.
- A selected different employee needs `TEAM_ATTENDANCE_READ` covered by an
  organization- or exact-agent-scoped grant.
- An unselected all-personnel grid needs an organization-scoped
  `TEAM_ATTENDANCE_READ` grant.
- A team or site scope is deliberately not inferred from mutable current
  membership for historical timesheets. It fails closed until a separately
  reviewed indexed historical-scope resolver is available.

Before the explicit C7 tenant flag, the established session/actor scope stays
unchanged. The route remains session-only; this change assigns no grant,
changes no flag or tenant and does not alter approval/export boundaries.

## Verification

```text
PASS  focused Vitest for Timesheet access, Today access and shared API routes
      (3 files / 31 tests) in this exact tree
PASS  scoped ESLint; git diff --check

NOT RUN  full TypeScript/build, recursive RLS scan, browser E2E, Android,
         applied RLS, isolated staging and physical attendance checks. Contabo
         policy prohibits the heavy/physical gates locally; the applicable
         compile/static checks run on the reviewable GitHub PR.
```
