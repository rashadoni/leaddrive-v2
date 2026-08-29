# Workforce C2d — effective-dated site assignment evidence

> **Status:** `WF-C2-005` implementation evidence; C2 gate remains open.
> **Recorded:** 2026-08-30T01:35:00+02:00

## Delivered contract

`WorkforceSiteAssignment` now records tenant-scoped employee eligibility for a
site as `PRIMARY`, `SECONDARY` or bounded `TEMPORARY`, with server-controlled
future effective dates and an accountable assigning administrator.

- A primary transfer appends the next primary assignment and closes the prior
  open primary window in the same transaction.
- Secondary sites can coexist. Duplicate overlapping windows for the same
  site/kind are rejected.
- Temporary assignment must have an explicit end date; it never silently closes
  or replaces the employee's primary site.
- Database triggers make assignment attributes append-only and allow only a
  one-time close of an open prior window. RLS, composite tenant foreign keys,
  transaction audit and scoped API predicates enforce tenant ownership.

The admin-only API is `GET/POST /api/v1/workforce/configuration/site-assignments`.
It reads only Workforce employee/site tables and has no Route assignment,
customer or route-geofence dependency.

## Boundary retained

This is an assignment **history**, not yet an attendance decision. C1-006/C2
segment/C3 snapshot work must resolve a historical assignment at the original
work date and persist it with the workday; current site/team must not be used
for a delayed upload. Travel compensation, expected duration and lateness
treatment remain owner decision `OD-09`.

## Verification run in this worktree

- `PASS` — `DATABASE_URL=<inert validation URL> npx prisma validate`; no DB
  connection/mutation.
- `PASS` — targeted Vitest: `workforce-site-management`,
  `api-workforce-sites`, `migration-workforce-site-assignments`,
  `migration-workforce-site-geofence-revisions`: **20 tests passed**. Includes
  primary transfer, bounded temporary assignment, past-date rejection and
  tenant/Route isolation.
- `PASS` — targeted ESLint and `git diff --check`.
- `NOT RUN` — isolated PostgreSQL migration/RLS/trigger execution, Prisma
  generate/typecheck/build/browser E2E/Android/load. The Contabo heavy lock is
  unavailable; no unwrapped heavy check was substituted.
