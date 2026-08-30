# Workforce C2c — geofence-revision foundation evidence

> **Status:** implementation evidence for `WF-C2-004`; the C2 gate remains
> open for separately owner-gated calibration/travel work.
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

## Historical snapshot completion

The later C3 snapshot writer now resolves the active revision at the accepted
workday's organization date and stores that immutable revision beside the
ordered SITE segments and the employee's effective site eligibility in the
same `WorkforceWorkdayScheduleSnapshot` transaction.  The schedule snapshot
hash covers that site context.  A later site/geofence edit cannot rewrite the
selected revision; older policy/shift pairs are explicitly returned as
`legacy_pair`, never reconstructed from live configuration.

The snapshot writer rejects a SITE segment unless its site is active, it has at
most one effective revision, and the employee has an effective eligibility
assignment.  The geometry evaluator consumes only the snapshotted circle and
returns `UNKNOWN` at an accuracy-overlapping boundary.  It never looks up the
current Route customer or current Workforce site to decide a historical fact.

Calibration numbers in the C2 ADR remain a technical starting standard, not
the required per-site physical calibration evidence. Tenant/legal approval,
accuracy/fresh GPS evidence assessment, QR/site binding and physical proof
remain C2/C4 work and do not reduce this schema/snapshot completion evidence.

## Verification run in this worktree

- `PASS` — `DATABASE_URL=<inert validation URL> npx prisma validate`; schema
  validation only, no database connection or mutation.
- `PASS` — serial targeted Vitest:
  `workforce-site-management`, `migration-workforce-site-geofence-revisions`,
  `workforce-snapshot-writer`, and `workforce-geofence-evaluation`:
  **25 tests passed**. It covers immutable revision rules, snapshot selection,
  effective eligibility and accuracy-safe geometry.
- `PASS` — `git diff --check`.
- `NOT RUN` — isolated PostgreSQL trigger/RLS/migration exercise and physical
  calibration; no database or approved physical-pilot evidence is attached.
- `NOT RUN` — Prisma generate/typecheck/build/browser E2E/Android/load. The
  previous `codex-heavy-run prisma generate` was refused because the Contabo
  shared-host heavy lock is unavailable; no unwrapped heavy check was used.
