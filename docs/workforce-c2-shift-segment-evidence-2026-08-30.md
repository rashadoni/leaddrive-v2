# Workforce C2 — ordered shift-segment evidence

> **Checkpoint:** `WF-C2-006` — 2026-08-30
>
> **Scope:** planned shift configuration only. This checkpoint does not start
> employee monitoring, evaluate GPS/QR/device evidence, calculate paid travel,
> or create a second workday.

## Delivered contract

`WorkforceShiftSegment` is a tenant-owned child of a versioned Workforce shift
template. A segment has a stable sequence, mode, optional Workforce-only site,
planned local start/end, late grace and an opaque proof-policy reference.

- `SITE` requires one active `WorkforceSite` in the same tenant.
- `REMOTE`, `FIELD`, `TRAVEL`, `ON_CALL` and `EXCEPTION` must not carry a site
  ID. They never fall back to a Route customer or Route geofence.
- A supplied timeline is chronological, non-overlapping, within the parent
  shift window and cannot overlap a declared planned break.
- A draft replacement atomically replaces the complete timeline. The database
  allows segment changes only while the parent template is `DRAFT`; active and
  retired configuration remains immutable.
- The migration has composite tenant foreign keys, range/order checks and
  forced RLS. It has no data rewrite or Route-table dependency.

The validated example is a single `Asia/Baku` workday with a planned 13:00–14:00
break and two scheduled site portions: `09:00–13:00 Site A` and `14:00–18:00
Site B`. It remains one reusable shift template, not two workdays.

## Reproducibility boundary

The active template plus its immutable child segments are reproducible schedule
configuration, and every configuration audit record contains the segment list,
count and canonical hash. C3-008 must still make a workday-level snapshot of
the resolved calendar, assignment, segment, site and policy values at the
accepted action. This checkpoint does not claim that future site/configuration
edits can alter an already accepted historical workday.

`TRAVEL` is intentionally representable as a segment but has no automatic paid
or expected-time treatment. Its compensation, delay grace and authorised
mutator stay under OD-09 / `WF-C2-008`.

## Verification

Passed on Contabo as one small sequential check:

```text
npx vitest run src/__tests__/workforce-configuration-management.test.ts \
  src/__tests__/api-workforce-configuration.test.ts \
  src/__tests__/migration-workforce-shift-segments.test.ts \
  --pool=forks --maxWorkers=1

3 files passed, 25 tests passed

DATABASE_URL=<inert> npx prisma validate --schema=prisma/schema.prisma
Prisma schema is valid

git diff --check
PASS
```

The targeted ESLint invocation passed with no errors; Prisma schema was skipped
by ESLint configuration, so Prisma validation is the schema evidence above.

## Not run

- `prisma generate`: **NOT RUN** — `codex-heavy-run` refused because the shared
  host lock was unavailable; raw generation is intentionally not retried on
  Contabo.
- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI or the approved ephemeral
  worker.
- Migration apply/rollback against a disposable PostgreSQL database: **NOT
  RUN** — no isolated database gate is available in this checkpoint.
