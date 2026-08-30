# Workforce C7 employment/history evidence

**Status:** WF-C7-004 partial source foundation; database application remains
an external release gate
**Date:** 2026-08-30

Workforce now has an additive, append-only employment lifecycle timeline for
explicit `HIRE`, `TERMINATION` and `REHIRE` facts. A lifecycle fact is a named
tenant-admin action, with a server-side transition/order check and a
metadata-only audit entry. It cannot update or delete an earlier fact.

The delayed-claim resolver composes three independent, date-correct sources:

| Need | Source | Safety property |
|---|---|---|
| Employment/re-entry/termination | `workforce_employment_events` | No lifecycle status is inferred from mutable employee-directory status. Missing history returns `UNKNOWN`. |
| Team transfer | Existing immutable `workforce_employee_team_memberships` | Resolves the latest membership at the claim instant, not the current team. |
| Primary/secondary/temporary site eligibility | Existing effective-dated `workforce_site_assignments` | Resolves only assignment windows covering the organization work date; it never calls Route tables. |

The new session-admin API records an explicit lifecycle event or previews this
historical assignment. It does not automatically reject/accept a workday,
change `MtmAgent.status`, change a team/site assignment, collect location or
make a payroll/disciplinary conclusion. The next lifecycle fact must be later
than the existing one, so a retroactive insertion/reordering needs a separate
reviewed correction contract rather than silently rewriting history.

The migration is expand-only, has no employment backfill, no trigger on
`MtmAgent.status`, RLS/forced RLS and an immutability trigger. In particular,
`ACTIVE`, `INACTIVE` and `SUSPENDED` remain directory/account states, not a
legal claim that someone was hired or terminated.

## Verification

    PASS  12 targeted Vitest tests, one sequential worker:
          workforce-employment-history,
          migration-workforce-employment-history,
          api-workforce-employment-events and rls-route-context-coverage
    PASS  prisma validate with an inert localhost DATABASE_URL
    PASS  targeted ESLint (one pre-existing shared-mock unused-parameter warning;
          no ESLint errors) and git diff --check
    NOT RUN  prisma generate did not emit a successful completion or update
             the local generated client after two bounded attempts; retry only
             in CI/approved worker, then run disposable migration apply and
             generated-client/typecheck gates
    NOT RUN  database migration/apply/rollback, full TypeScript/build, browser
             E2E, Android, production-like concurrency and physical-pilot
             checks; Contabo must not run those heavy or external gates.
