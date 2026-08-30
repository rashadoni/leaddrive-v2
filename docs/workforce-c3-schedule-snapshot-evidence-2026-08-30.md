# Workforce C3 — accepted workday schedule snapshot evidence

**Task:** `WF-C3-008`
**Checkpoint:** pending commit on `codex/implement-hrm-plan`
**Status:** DONE (server-side deterministic-snapshot foundation)

## Delivered contract

Each newly accepted Workforce START now creates, in the same database
transaction as the existing policy and shift snapshots, exactly one immutable
`WorkforceWorkdayScheduleSnapshot`. It records:

- the resolved calendar state and its no-show/exception semantics;
- the selected policy and shift snapshot IDs;
- the ordered shift segments, including mode, site, planned window, grace and
  proof-policy reference;
- the active scheduled sites and their effective geofence revisions; and
- a canonical SHA-256 hash of that context.

The write path is shared by the existing web workday writer and the mobile sync
push writer. A failed schedule-context write rolls the enclosing START
transaction back; an already complete trio returns idempotently. A historical
policy/shift pair created before this checkpoint is reported as `legacy_pair`:
the system intentionally does not reconstruct supposedly historical facts from
today's mutable calendar, site or geofence configuration.

The new row has tenant RLS, tenant-bound foreign keys, INSERT validation and a
database trigger rejecting UPDATE/DELETE. Tenant and employee deletion guards
now include it, so retention cannot be bypassed by deleting a parent record.

## Verification run in this worktree

- PASS — targeted Vitest: snapshot writer, shift resolution, migration contract,
  retention guard, MTM agent/mobile week/mobile workday/mobile sync: **9 files,
  178 tests**.
- PASS — `npx prisma validate` with an inert local URL.
- PASS — targeted ESLint: no errors. One existing unused `_options` warning in
  the shared MTM Prisma mock; Prisma schema is ignored by the current ESLint
  configuration.
- PASS — `git diff --check`.

## Explicitly not run

- NOT RUN — `prisma generate`, migration apply/rollback and production data
  validation: require the approved database/CI route; no database was changed.
- NOT RUN — full TypeScript/build, browser E2E, Android, physical QR/GPS or
  load checks: these are heavy gates reserved for CI or an approved worker.

## Remaining boundary

This checkpoint freezes the expected schedule facts. It does not decide paid
lunch, split/overnight/rest, travel compensation or physical proof policy;
those owner/legal decisions and their dependent tasks remain open.
