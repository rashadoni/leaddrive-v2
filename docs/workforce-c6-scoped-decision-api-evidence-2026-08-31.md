# Workforce C6 — scoped immutable decision API (2026-08-31)

## Scope

`WF-C6-002` now has a browser-session API for an accountable human exception
decision:

`POST /api/v1/workforce/exceptions/:id/decisions`

The route accepts only a bounded idempotency key, one recommended-v1 lifecycle
decision code and a mandatory bounded reason. It reads the case's employee,
team and optional site context inside a serializable transaction and asks the
C7 grant resolver for `TEAM_EXCEPTION_DECIDE` on exactly that scope.

No legacy CRM admin role, API key or broad session role becomes an exception
authority. In the current inactive-grant state the resolver returns deny, so
the route cannot write a decision until a separate forward-only C7 grant
migration and rollout create an effective scoped grant.

## Lifecycle and privacy safeguards

- The policy-aware writer takes a PostgreSQL advisory lock for the case before
  it reads prior decision codes and evaluates the next transition. Concurrent
  reviewers cannot both validate stale incompatible transitions.
- It checks an exact operation replay after acquiring the lock. Retrying an
  already completed resolution is idempotent; a changed payload under the same
  operation ID is a conflict.
- The normal response deliberately makes a missing case and an unavailable
  scope indistinguishable. It returns only the decision id/idempotency result,
  never evidence, coordinates, QR, device proof or decision reason.
- The decision does not mutate attendance facts, timesheet approvals, payroll,
  discipline, evidence or a case row. It appends a metadata-only audit record.

## Verification

Passed in this worktree:

```text
vitest: 5 targeted C6/C7 API, writer and access-resolution files / 26 tests
eslint: route, writer, resolver, tests and shared Prisma mock (0 errors)
git diff --check
```

`NOT RUN`: disposable-DB migration/RLS/serializable-concurrency exercise,
grant-assignment endpoint and access review, rendered manager workbench,
browser E2E for the new mutation, full typecheck/build, staging and pilot.
The route is source-complete but intentionally default-deny until the durable
grant rollout exists.
