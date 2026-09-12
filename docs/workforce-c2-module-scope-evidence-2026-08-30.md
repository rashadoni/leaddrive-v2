# Workforce C2h — organization, team and site API isolation evidence

> **Status:** implementation evidence for `WF-C2-010`; the C2 gate remains
> open for its separately recorded calibration, travel and transition work.
> **Recorded:** 2026-08-30

## API and permission boundary

The Workforce configuration surface is tenant-scoped and independently
authorised through `withWorkforceSessionAdminAuth`, not through Route & Field:

| Scope | Workforce API surface | Boundary |
|---|---|---|
| Organization | policy/shift draft and activation, default/individual assignment previews, Workforce site inventory | every read/write scopes `organizationId` to the authenticated tenant; configuration changes require a current admin/superadmin session and audit context |
| Team | policy and shift templates carry an optional `teamId`; historical membership resolves team-scoped policy/shift selection at workday start | an absent or pre-history team fact cannot be reconstructed from the mutable employee directory |
| Site | site lifecycle, effective geofence revisions and employee site assignments | tenant-scoped `WorkforceSite*` records, future-effective writes and no physical monitoring activation |
| Employee/manager read | `/api/v1/workforce/today`, requests and timesheets | Workforce role/territory scope is applied before workday/request facts are queried; employee scope stays self-only |

The public configuration endpoints live only under `/api/v1/workforce/*`.
They do not query or mutate `MtmCustomer`, `MtmRoute`, Route points, Route
assignments or customer geofences.  HRM-only tenants can use the Workforce
capability while Routes-only tenants fail closed at the independent capability
boundary.  Legacy shared MTM transports retain their explicit compatibility
contracts, but are not a prerequisite for these configuration APIs.

## Safety guarantees

- Administrative configuration requires a signed-in administrator, not an
  API-key write scope; it writes future configuration facts with audit context.
- Site archive is an auditable status transition, never a delete; existing
  historical references remain explainable.
- Site assignment and shift assignment accept only tenant-scoped employee,
  site and template references and derive the effective "today" date from the
  server-side organization timezone.
- Team selection for facts is effective-dated; a delayed claim cannot acquire
  today’s team merely because the employee was transferred later.
- This slice does not give a manager raw GPS evidence, manufacture a team
  history, couple a Workforce site to a Route customer, or enable location
  collection.

## Checks run in this worktree

- `PASS` — serial targeted Vitest: `api-workforce-sites`,
  `api-workforce-configuration`, `api-workforce`, `with-workforce-rls-auth`,
  and `api-mtm-mobile-manager-workforce-boundary`: **40 tests passed**.
  This verifies tenant/actor scope, session-admin configuration, HRM-only
  reads, Routes-only denial/omission and no Route table calls from the site
  surface.
- `PASS` — `git diff --check`.
- `NOT RUN` — full typecheck/build/browser E2E, migration/RLS exercise against
  isolated PostgreSQL, Android/device and load testing.  They are not safe to
  run on the shared Contabo host and no approved heavy worker is attached.
