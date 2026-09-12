# Workforce C3 — calendar semantics

> **Checkpoint:** `WF-C3-002` — 2026-08-30

## Delivered contract

The retained tenant-scoped `MtmWorkCalendarDay` ledger is now consumed through
a Workforce-only calendar adapter. It does not read Route assignments,
customers or Route planning policy, and it deliberately ignores the legacy
`routePlanningAllowed` flag when determining attendance expectations.

For an employee/date the adapter resolves the established precedence
`employee → team → organization → weekday/weekend default` and returns a
separate HRM state:

- `SCHEDULED` — attendance expected; eligible for a later C6 no-show review;
- `NON_WORKING`, `PUBLIC_HOLIDAY` or `TENANT_CLOSURE` — no attendance is
  expected;
- `APPROVED_LEAVE`, `APPROVED_ABSENCE` or `PERSONAL_EXCEPTION` — no-show is
  ineligible and the person-level exception is explicit.

Approved Workforce leave/absence decisions now write the unambiguous source
markers `WORKFORCE_LEAVE` / `WORKFORCE_ABSENCE`. Old arbitrary source text is
never reinterpreted as approved leave. `GET /api/v1/workforce/today` exposes
the resolved calendar state next to the raw workday state; `NOT_STARTED` is
therefore not presented as a no-show.

## Boundary

The current calendar data model remains the additive, RLS-protected canonical
tenant calendar from the original HRM plan. This checkpoint adds no second
calendar and no Route dependency. C3-008 must still snapshot the resolved
calendar state with an accepted workday so later calendar edits cannot affect
historical calculation.

## Verification

Small sequential Contabo checks passed:

```text
npx vitest run src/__tests__/workforce-calendar.test.ts \
  src/__tests__/api-workforce.test.ts \
  src/__tests__/workforce-request-decision.test.ts \
  src/__tests__/api-mtm-operations.test.ts \
  --pool=forks --maxWorkers=1

4 files passed, 40 tests passed
```

## Not run

- Full TypeScript check, production build and browser verification: **NOT
  RUN** — CI/approved worker only on this Contabo host.
- Calendar snapshot/replay after later edits: **NOT RUN** — explicitly tracked
  as C3-008, not claimed by this live calendar-resolution checkpoint.
