# Workforce C7 actor-independent read grant evidence

Date: 2026-09-13

Scope: `WF-C7-002` partial migration of Today and Timesheet to first-class,
persisted Workforce authority.

## Accepted behavior

- After a tenant deliberately enables `workforce-granular-access-v1`, a
  signed-in principal with an effective persisted Workforce grant can read the
  exact current-day or timesheet scope authorized by that grant even when the
  principal has no active legacy CRM `MtmAgent` row.
- The authorization decision happens before employee names or attendance facts
  are read. The initial Today candidate query contains only technical employee
  and current-team IDs; Timesheet accepts only self, exact-agent or
  organization authority in this slice.
- A tenant without the explicit granular flag retains its existing CRM actor
  ceiling and scoped roster query. No broad fallback is introduced.
- Grant-only Today responses are labelled `GRANT` and never expose an employee
  self-action model. A delegated reviewer therefore cannot mutate another
  employee's day through a read response.
- Current team scope is valid only for Today. Historical Timesheet team/site
  authorization remains fail-closed until the immutable membership-at-workday
  adapter is integrated.

## Safety and rollout

This change assigns no grant, enables no tenant feature, and changes no Route &
Field or mobile behavior. Access remains session-only and the existing bounded
grant/revocation reader is reused.

## Verification

- Targeted Vitest passed 3 files / 33 tests, covering a grant-only Team Manager Today read and an exact
  Agent-scoped Time Approver Timesheet read, both without a CRM actor.
- Existing library tests continue to cover legacy pass-through, self, grant,
  denial and unavailable states.
- Scoped ESLint and `git diff --check` passed.
- Full build, browser E2E, Android, disposable-database RLS and production smoke
  are **NOT RUN locally** on Contabo; repository CI/deploy owns applicable
  heavy gates.
