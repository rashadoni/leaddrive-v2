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

## Deliberate rollout boundary

No Prisma model, migration, UI, endpoint wrapper or existing role mapping is
changed by this source slice. That avoids an accidental production lockout or
an unreviewed conversion of broad legacy CRM roles. A later forward-only C7
migration must add durable grants, record accountable grant/revoke audit,
enforce the recorded incompatible-role rules and migrate each endpoint behind
an explicit tenant rollout fence before it can claim enforcement.

## Verification

- `PASS` — focused grant tests cover exact self scope, team scope, cross-role
  denial, invalid effective/revocation windows, raw-evidence denial, stable
  incompatible-role detection and unknown-role failure.
- `NOT RUN` — Prisma migration/generate, browser role assignment, endpoint
  integration, database RLS, access-review operations and production rollout;
  these require the later C7 migration/rollout and approved external gates.
