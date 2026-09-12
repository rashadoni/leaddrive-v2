# Workforce C1e — historical employee-team membership evidence

> **Status:** `WF-C1-006` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T07:40:00+02:00

## Historical-team contract

`WorkforceEmployeeTeamMembership` is an append-only, tenant-RLS-protected
timeline of the team known for an employee at a server instant. A database
trigger records every new employee and subsequent `MtmAgent.teamId` transfer.
The reader locks the mutable employee directory row and selects the latest
membership effective at `workday.startedAt`, so a concurrent transfer is
serialized with snapshot creation.

Policy and shift selection use that exact historical team, not the current
directory value when a delayed offline request reaches the server. A matching
team policy/shift wins only if it was active for the workday start; a version
activated later cannot rewrite a prior workday. The v2 schedule snapshot
records the membership ID and team ID alongside its calendar, policy, shift,
site and segment context. Database validators enforce the same rule for direct
inserts.

The migration writes a clearly bounded `MIGRATION_BASELINE` at its own rollout
instant. It does **not** fabricate any earlier history: a workday predating all
known membership facts may use an applicable organization policy but cannot
use a team policy or team shift. Existing snapshots and directory data are not
rewritten.

## Verification

- `PASS` — policy and shift resolver tests prove a historical team A is chosen
  after the employee directory has moved to team B; a later policy cannot
  displace the workday-start policy.
- `PASS` — snapshot writer records the same historical membership in schedule
  snapshot v2 and rejects inconsistent policy/shift resolver results.
- `PASS` — migration contract test covers append-only trigger, RLS, no
  pre-migration inference, historical validators and schedule snapshot v2.
- `PASS` — targeted suite: 35 tests passed.
- `PASS` — `prisma validate`, ESLint for changed TypeScript paths and
  `git diff --check`.
- `NOT RUN` — disposable-database migration apply/rollback and generated Prisma
  client verification: schema changes are CI/approved-worker gates, not raw
  Contabo actions.
- `NOT RUN` — full typecheck, build, browser E2E, Android, load, production
  deploy and physical device checks: CI/heavy-worker or real-world gates only.

## Scope boundary

This completes historical team selection for Workforce policy/shift snapshots.
It does not expand the separately reviewed organization-wide default-shift
timeline into a team-default writer, and it does not alter retained legacy
facts or enable an attendance pilot.
