# Workforce C10 — one-year time/decision retention hold evidence

**Status:** safe partial. The delivery adds a fail-closed legal-hold data
contract and a read-only candidate inventory. It deliberately does **not** add
an executor that deletes immutable Workforce time/decision records.

## Delivered contract

- `WorkforceLegalHold` is an additive tenant-scoped model for the only current
  scope: `TIME_DECISION`. An active hold blocks the entire tenant's one-year
  time/decision inventory rather than guessing a narrow employee/case scope.
- The migration enforces tenant RLS and prevents deletes. A hold is immutable
  except for one recorded `ACTIVE` -> `RELEASED` transition with actor/time.
  The stored `matterReference` is an opaque reference, not legal documents,
  coordinates, employee reasons or other sensitive payload.
- `planWorkforceTimeDecisionRetention` calculates the cutoff as a calendar
  year, not a fixed 365-day interval, and inventories only explicit eligible
  classes: time facts, derived assessments, decided/cancelled requests,
  resolved exceptions, corrections, approvals and Workforce audit facts.
- The hold lookup happens before any candidate query. An active hold returns
  zero candidates; an unavailable hold store throws and cannot be transformed
  into a no-hold result. Pending requests and unresolved exceptions are not
  candidates.
- The returned `execution` is always `NOT_AVAILABLE`. There is no HTTP route,
  scheduler, direct Prisma delete or raw SQL delete for this lifecycle slice.

## Verification performed

- `src/__tests__/workforce-time-decision-retention.test.ts`: calendar cutoff,
  no-hold candidate inventory, active-hold stop and unavailable-hold fail-close.
- `src/__tests__/migration-workforce-legal-holds.test.ts`: schema/migration
  shape, immutable release and RLS/no-executor source contracts.
- `DATABASE_URL=postgresql://validation:validation@127.0.0.1:5432/validation?schema=public npx prisma validate --schema prisma/schema.prisma`: **PASS**.

## Remaining gates

- The new migration was **not applied** to any database and `prisma generate`
  remains a distinct generated-client check. No production or tenant data was
  inspected, created, released or deleted.
- C7/OD-10 must assign a legal-hold/retention officer and separation of duties
  before any writer can create or release a hold. That future writer must be
  MFA-gated and create immutable access/audit records atomically.
- Legal/Privacy must define the authoritative hold intake, scope, release
  authority and one-year retention obligations. An absent row is not legal
  approval for a destructive operation.
- Backup/restore, batch cursor/lease, pressure stop, database RLS/integration,
  staging purge and reconciliation evidence are **NOT RUN**. A destructive
  executor must remain unavailable until those gates are green.
