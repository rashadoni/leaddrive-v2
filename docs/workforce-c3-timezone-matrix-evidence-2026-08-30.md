# Workforce C3 — timezone and DST matrix evidence

**Task:** `WF-C3-010`
**Checkpoint:** pending commit on `codex/implement-hrm-plan`
**Status:** DONE (deterministic shift-resolution guard)

## Delivered contract

Workforce resolves each shift from the organization work date and the signed
IANA timezone, never from the server date or browser timezone. The matrix
covers the LeadDrive Baku default, Europe/Berlin on both DST transition days,
a leap-day assignment, and organization dates that start on a previous UTC day
or end on a following UTC day.

The generic compatibility converter keeps its existing behavior for legacy
queries. Workforce shift resolution now uses the stricter
`localDateTimeToUnambiguousUtc` helper: a local clock value in a DST gap or
fold is rejected rather than silently shifted or assigned one of two possible
instants. A tenant that needs such a schedule must first publish an explicit,
reviewed DST policy; that is safer than embedding an unrecorded choice in a
timesheet snapshot.

## Verification run in this worktree

- PASS — targeted Vitest: timezone utility, Workforce shift definition,
  resolution and schedule snapshot: **4 files, 64 tests**.
- PASS — Baku `09:00-18:00` remains `05:00-14:00Z` and no-DST behavior is
  unchanged.

## Explicitly not run

- NOT RUN — full TypeScript/build/browser E2E, Android and physical
  multi-timezone device checks: heavy gates belong to CI or an approved worker.
- NOT RUN — migration/database checks: this task adds no migration.
