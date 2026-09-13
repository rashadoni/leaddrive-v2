# Workforce C7 — granular access foundation

> **Status:** safe partial source foundation for `WF-C7-002`; it does not
> assign, persist or activate grants.
> **Recorded:** 2026-08-30

## Delivered contract

`src/lib/workforce/access-control.ts` defines the approved initial Workforce
role vocabulary as separate, non-inheriting grants: tenant admin, HR admin,
scheduler, time approver, evidence reviewer, device-security admin, export
custodian, retention/hold officer, pilot/rollback operator and team manager.
Employee self-service is not a grant: it succeeds only for the exact resolved
employee subject.

Every candidate grant carries an organization, principal, role, explicit
organization/team/site/employee scope, effective window and revocation time.
The pure evaluator fails closed on tenant mismatch, another employee, an
expired/future/revoked grant, a scope outside the role's permitted boundary or
a permission belonging to another role.

The recommended least-privilege mapping deliberately does not make a tenant
admin an implicit evidence/device/export/retention/pilot superuser. A raw
coordinate, QR or device-proof read is absent from the ordinary role
vocabulary entirely; it remains blocked until C10 adds a separate
purpose/reason/audit/investigation decision.

The approved management boundary now also names `TEAM_EXCEPTION_DECIDE`.
`HR_ADMIN` may resolve a Workforce exception within an explicit organization,
team or site grant; `TEAM_MANAGER` may do so only within its explicit team or
site grant. Neither role receives raw evidence, payroll, disciplinary or
approval authority from that permission. `TIME_APPROVER` remains deliberately
separate, so the existing incompatible-role guard still prevents one person
from combining a time approval with team management.

The owner-approved recommended v1 draft also makes these role pairs
incompatible for a future assignment flow: scheduler/time approver, time
approver/team manager, evidence reviewer/device-security admin and export
custodian/retention-hold officer. The pure validator de-duplicates and orders
roles deterministically, and fails closed for unknown roles or a conflicting
pair. It is a planning guard only: it does not create, reject, revoke or
modify a durable tenant grant.

The immutable approved-time report is another C7 read consumer. After the
flag, it requires `TEAM_ATTENDANCE_READ`; a selected employee is matched only
by exact employee scope, while an aggregate can use only organization scope.
It does not resolve a current team/site for historical rows and never falls
back to CRM admin after cutover.
## Deliberate rollout boundary

No migration has been applied, grant row created or existing role mapping
replaced. The new C6 decision route is deliberately default-deny: it reads
only an effective durable C7 grant and otherwise makes no write, so a legacy
CRM role cannot become a hidden exception authority. A later forward-only C7
service must assign and review the grants, migrate each endpoint behind an
explicit tenant rollout fence and run access review before it can claim live
enforcement.

## Verification

- `PASS` — focused grant tests cover exact self scope, team scope, cross-role
  denial, invalid effective/revocation windows, raw-evidence denial, stable
  incompatible-role detection and unknown-role failure.
- `NOT RUN` — Prisma migration/generate, browser role assignment, endpoint
  integration, database RLS, access-review operations and production rollout;
  these require the later C7 migration/rollout and approved external gates.
- `PASS` — focused approved-report contracts preserve the unflagged boundary,
  deny an ungranted administrator after cutover and accept an exact
  employee-scoped `TEAM_ATTENDANCE_READ` grant without a mutable team lookup.
