# Workforce C3 — future default-shift timeline

> **Checkpoint:** `WF-C3-007` — 2026-08-30

## Delivered contract

`WorkforceShiftDefaultAssignment` is an additive, tenant-RLS-protected,
effective-dated timeline for the **organization-wide** default shift. The
future default endpoint accepts only a signed-in Workforce administrator and a
date after the tenant's current date. A replacement closes its predecessor on
the prior date in the same advisory-locked transaction, writes two audit
records, and cannot rewrite a previously snapshotted day.

The resolver chooses, in order:

1. an individual effective-dated assignment;
2. a covering `WorkforceShiftDefaultAssignment`;
3. the existing `isDefault` mechanism solely as a compatibility fallback.

When a timeline row is selected, `WorkforceShiftSnapshot` records its exact
ID. SQL guards enforce non-overlap, active organization-scoped template input,
no deletion, monotonic narrowing only and snapshot/date/template consistency.
No migration backfills a history for existing timeless `isDefault` rows, so
past attendance is not guessed.

## Deliberate limit

New **team** default timelines remain rejected in this checkpoint. C1-006 now
adds an immutable historical team-membership fact for new workdays, but the
organization-default table is intentionally not broadened incidentally: team
timeline write semantics, authorization and migration guards require their own
review. Existing legacy team-default compatibility remains unchanged.

The new table is included in the tenant-retention preflight. Calendar leave
source markers added in C3-002 are also covered by the retention fence.

## Verification

Small sequential Contabo checks passed:

```text
npx vitest run src/__tests__/api-workforce-configuration.test.ts \
  src/__tests__/workforce-configuration-management.test.ts \
  src/__tests__/workforce-shift-resolution.test.ts \
  src/__tests__/workforce-snapshot-writer.test.ts \
  src/__tests__/migration-workforce-shift-default-timeline.test.ts \
  src/__tests__/mocks/mtm-prisma.test.ts \
  src/__tests__/workforce-retention-guard.test.ts \
  src/__tests__/api-mtm-agents.test.ts \
  --pool=forks --maxWorkers=1

8 files passed, 96 tests passed

npx eslint <changed TypeScript paths>
PASS

DATABASE_URL=<inert> npx prisma validate --schema=prisma/schema.prisma
Prisma schema is valid

git diff --check
PASS
```

## Not run

- `prisma generate` and disposable database migration apply/rollback: **NOT
  RUN** — raw Prisma generation and migration execution are not permitted on
  this Contabo host; CI/approved worker must apply the schema gate.
- Full typecheck, production build, browser E2E, Android and load: **NOT RUN**
  — CI/approved worker gates only.
