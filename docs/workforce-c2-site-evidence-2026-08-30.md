# Workforce C2b — independent site lifecycle evidence

> **Status:** `WF-C2-002` implementation evidence; C2 gate remains open.
> **Recorded:** 2026-08-30T01:22:00+02:00

## Delivered boundary

`WorkforceSite` is now a tenant-scoped Workforce configuration record with a
unique code, name, site type, IANA timezone, optional address label, optional
responsible team and auditable `ACTIVE` → `ARCHIVED` lifecycle. It is a
separate table with its own RLS policy and composite tenant foreign keys.

The admin-only endpoints are:

- `GET/POST /api/v1/workforce/configuration/sites`
- `POST /api/v1/workforce/configuration/sites/:id/archive`

Creation and archival each acquire a scoped advisory lock and write their
configuration audit in the same transaction. Archival requires a reason in the
audit and never deletes the row, so future assignment/geofence/snapshot facts
can keep an explainable reference.

No endpoint reads or writes `MtmCustomer`, `MtmRoute`, Route points, Route
assignments or customer geofence settings. Creating a site does not create a
workday, assign a worker, evaluate location, mint a QR token or enable
monitoring.

## Scope deliberately left for later C2/C4 slices

- immutable/effective-dated circle revisions and site calibration evidence;
- employee primary/secondary/temporary assignment history;
- ordered multi-site shift segments, transition facts and historical snapshots;
- QR station-to-site binding and location evidence evaluation;
- inter-site travel pay/expected-time policy (`OD-09` remains open).

`HOME_REMOTE` is a declared site type, while Field, Travel and On-call remain
segment modes rather than a reason to store an employee's exact home or field
coordinates.

## Verification run in this worktree

- `PASS` — `DATABASE_URL=<inert validation URL> npx prisma validate`; schema
  validation only, no database connection or mutation.
- `PASS` — targeted Vitest:
  `workforce-site-management`, `api-workforce-sites`,
  `migration-workforce-sites`: **10 tests passed**. It covers create/archive
  transaction/audit behavior, tenant-scoped APIs, Route independence and static
  migration/RLS constraints.
- `PASS` — targeted ESLint for the new service, routes and tests.
- `PASS` — `git diff --check`.
- `NOT RUN` — Prisma Client generation. `codex-heavy-run npx prisma generate`
  correctly refused because the Contabo shared-host heavy lock is unavailable;
  no unwrapped retry was substituted. CI/approved worker must generate before
  a release typecheck.
- `NOT RUN` — isolated PostgreSQL migration apply/rollback/RLS exercise,
  full typecheck/build, browser E2E, Android/device and load testing. No
  database or approved heavy worker is attached to this worktree.
