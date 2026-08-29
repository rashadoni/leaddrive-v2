# Workforce C2c — geofence-revision foundation evidence

> **Status:** partial foundation for `WF-C2-004`; it does not close the task or
> the C2 gate.
> **Recorded:** 2026-08-30T01:28:00+02:00

## Delivered safely

The Workforce module now has a tenant-scoped, effective-dated **circle v1**
geofence revision model and admin API. A new revision must be scheduled after
the organization-local current date, can only append after the latest timeline
entry, and closes the prior open window inside the same transaction.

The database validates latitude/longitude, 25–5,000m radius, calibration
reference, hash, date order, tenant/site foreign keys and non-overlapping
windows. It also blocks a geometry rewrite or deletion: only the prior open
window's end date can be set once for a future replacement. The audit projection
contains revision/hash/radius/window, not raw coordinates or calibration text.

The independent endpoints are:

- `GET/POST /api/v1/workforce/configuration/sites/:id/geofences`

They consult Workforce sites only; they do not touch Route/customer geofence
data and do not evaluate an employee's location or create attendance evidence.

## Why this remains partial

There is deliberately no workday/segment snapshot yet, so a historical
workday cannot yet point to a resolved geofence revision. That requires C2
effective site assignment/ordered segments and C3 snapshot wiring. Calibration
numbers in the C2 ADR are a technical starting standard, not the required
per-site physical calibration evidence. Tenant/legal approval, accuracy/fresh
GPS evidence assessment and QR/site binding remain C2/C4 work.

## Verification run in this worktree

- `PASS` — `DATABASE_URL=<inert validation URL> npx prisma validate`; schema
  validation only, no database connection or mutation.
- `PASS` — targeted Vitest:
  `workforce-site-management`, `api-workforce-sites`,
  `migration-workforce-site-geofence-revisions`,
  `migration-workforce-sites`: **16 tests passed**.
- `PASS` — targeted ESLint and `git diff --check`.
- `NOT RUN` — isolated PostgreSQL trigger/RLS/migration exercise and historical
  workday snapshot integration; no database is attached and the latter depends
  on subsequent C2/C3 slices.
- `NOT RUN` — Prisma generate/typecheck/build/browser E2E/Android/load. The
  previous `codex-heavy-run prisma generate` was refused because the Contabo
  shared-host heavy lock is unavailable; no unwrapped heavy check was used.
