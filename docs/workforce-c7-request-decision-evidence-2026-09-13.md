# WF-C7-006 — manager request decision acceptance

## Delivered boundary

The existing Workforce request workbench and API implement the complete
manager-decision boundary without making Route & Field a dependency.

- The list endpoint resolves the signed-in Workforce actor and returns only
  organization or assigned team/region scope, with an immutable cursor and a
  250-row ceiling. Employees see only their own requests and cannot decide.
- A manager can approve or reject a pending leave, absence or time-correction
  request. Rejection requires a reason; a repeated identical terminal decision
  is idempotent and a different terminal decision is an explicit conflict.
- Request state, leave/absence calendar facts, immutable correction facts,
  notifications and the accountable audit append in one transaction. A lost
  concurrent update or audit failure cannot leave a successful decision.
- Route & Field is queried only when that independent capability is enabled.
  Active overlaps require explicit acknowledgement, but the operation never
  edits a route. A Route entitlement/read failure leaves the HR decision path
  available rather than coupling the modules.
- The web workbench exposes the pending queue, approval/rejection actions,
  required rejection reason and explicit conflict acknowledgement already
  backed by those server checks.

## Verification

```text
PASS  npx vitest run
      workforce-request-decision,
      api-workforce-self-requests,
      workforce-self-request-ui-contract
      (3 files, 12 tests)
PASS  exact production artifact ff67047d2d62c35527234e1c389d7e97421bbee3
      built the request API and Workforce web surface; deploy 34752597613
      completed migrations, DB probe and public smoke.
NOT RUN  physical Android and named-pilot exercise; those are separate C9/C14
         tasks and are not required to accept this manager web/API boundary.
```

## Acceptance

WF-C7-006 is **DONE**. Manager queue scope, route-conflict acknowledgement,
idempotent decision and immutable/transactional audit are implemented. This
does not claim payroll semantics or permit Route to decide Workforce facts.

## Granular-access follow-on

After the explicit `workforce-granular-access-v1` cutover, the legacy CRM
actor scope is no longer accepted as decision authority. Leave and absence
decisions require `TEAM_REQUEST_DECIDE`; an immutable time correction requires
the separate `TIME_APPROVE` permission. The resource team is resolved at the
request submission instant, or at the linked workday start for a correction,
and is never inferred from the employee's mutable current directory row.

The service checks the persisted grant before any Route-conflict preview and
checks the rollout fence plus grant again in the mutation transaction. A
revoked grant therefore cannot race a successful decision. Missing history or
an unavailable grant lookup fails closed, organization/exact-agent scopes stay
usable, and an employee can never decide their own request even if they hold a
separate grant.

Focused verification on the delivery stack passed 11 request-decision tests,
3 persisted-grant resolver tests, scoped ESLint and `git diff --check`. No
tenant flag or grant is created by this source checkpoint.
