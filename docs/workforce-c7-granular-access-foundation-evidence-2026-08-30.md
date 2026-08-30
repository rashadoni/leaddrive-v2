# Workforce C7 — granular access foundation

> **Status:** safe partial source foundation for `WF-C7-002`; durable storage
> is additive but no grant is assigned, read or activated.
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

`20260830193000_workforce_access_grants` now defines the dormant durable
storage required by the next rollout phase. An immutable grant names its
tenant principal, exact organization/team/site/employee scope, effective
window, accountable grant actor and reason code. It can end only by a separate
append-only revocation naming an accountable actor/reason/time; replacement is
always revoke-plus-new-grant. Database constraints enforce one exact scope and
the permitted scope kinds for each role; the insert guard also fails closed on
all owner-approved incompatible pairs whose effective windows overlap. Both
tables have tenant RLS, only `SELECT`/`INSERT` policies and mutation-rejection
triggers.

`src/lib/workforce/access-grant-ledger.ts` supplies the matching pure draft
writer. It normalizes exact scopes, role/scope compatibility, bounded opaque
identifiers, reason codes, stable operation IDs and effective windows;
revocation drafts cannot predate their grant.

`src/lib/workforce/access-grant-writer.ts` is the next, still-unwired
transaction-scoped primitive. It requires a caller-provided authorization
decision, serializes one tenant-principal with a PostgreSQL advisory transaction
lock, creates exactly one append-only grant or revocation and records a
metadata-only audit entry in the same transaction. An operation ID is unique
per tenant: an exact retry returns the original record, while a changed payload
under the same ID fails closed. A revocation re-reads and matches the immutable
grant start before writing, so a stale caller cannot revoke a different grant.
The new operation-ID migration deliberately refuses non-empty dormant storage
instead of inventing identifiers for direct database authority rows.

## Deliberate rollout boundary

The migration creates no grant row and changes no tenant flag, role mapping or
existing authorization by itself. Existing grant-aware endpoints remain behind
the explicit granular-access rollout fence and fail closed when the fence is on
without a matching grant. A later forward-only C7 service must atomically
authorize and write grants/revocations, assign an accountable initial cohort
and run access review before live enforcement can be claimed.

## Verification

- `PASS` — focused grant tests cover exact self scope, team scope, cross-role
  denial, invalid effective/revocation windows, raw-evidence denial, stable
  incompatible-role detection and unknown-role failure.
- `PASS` — focused approved-report contracts preserve the unflagged boundary,
  deny an ungranted administrator after cutover and accept an exact
  employee-scoped `TEAM_ATTENDANCE_READ` grant without a mutable team lookup.
- `PASS` — static migration contract tests cover exact scope, role/scope
  constraints, append-only revocation, RLS, every incompatible pair and the
  fail-closed operation-ID migration; `prisma validate` passed without a
  database connection. Focused writer tests cover invalid scope/window,
  pre-grant revocation rejection, mandatory authorization, tenant-principal
  serialization, metadata-only audit, exact replay and changed-operation
  conflict rejection.
- `NOT RUN` — browser role assignment, endpoint integration, database RLS
  concurrency and tenant activation require the later C7 rollout gates.
