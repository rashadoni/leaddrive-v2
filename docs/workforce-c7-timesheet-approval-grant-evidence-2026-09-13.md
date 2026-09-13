# Workforce C7 timesheet approval grant evidence

Date: 2026-09-13

Scope: partial `WF-C7-002` migration of the immutable timesheet approval writer
from legacy CRM actor scope to an explicit Workforce `TIME_APPROVER` grant.

## Accepted behavior

- Before granular cutover, the established non-employee manager/admin actor
  scope remains authoritative and unchanged.
- After `workforce-granular-access-v1` cutover, approval requires an effective
  `TIME_APPROVER` grant whose organization/exact-agent scope covers the target
  employee. A legacy CRM role neither adds nor removes that authority.
- A grant-only signed-in principal can approve without an `MtmAgent` mapping;
  the route remains session-only and cannot be called by an API key.
- The service resolves the feature fence and grant before reading the target
  employee. Ungranted callers receive the same forbidden result for missing and
  existing employee IDs, preventing a directory oracle.
- Self-approval remains forbidden by both actor ID and the target employee's
  linked user ID. A bad external assignment therefore cannot bypass separation
  of duties.
- Successful audit metadata records `WORKFORCE_GRANT` as the authorization
  source without copying grant reasons or other sensitive grant details.

This slice does not create a grant, activate a tenant, change approval facts,
or weaken immutable history/exception blockers.

## Verification

- Targeted Vitest passed 2 files / 22 tests, including grant-only approval,
  out-of-scope legacy actor with an independent grant, missing grant, self
  approval, route delegation and all existing immutable approval cases.
- Scoped ESLint and `git diff --check` passed.
- Full build, browser E2E, Android, disposable-database RLS and production smoke
  are **NOT RUN locally** on Contabo; applicable heavy gates remain CI-owned.
