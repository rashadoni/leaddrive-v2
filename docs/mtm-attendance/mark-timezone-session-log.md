# Attendance mark timestamp compatibility — session journal

## 2026-10-14 — production evidence and bounded fix

- Coordinator authorized this safety-lane fix after physical S23 START remained
  durable/pending while its server transaction rolled back. No queue clearing,
  duplicate physical START, production SQL writes or geodata enablement.
- Clean worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-mark-timezone`,
  branch `codex/mtm-attendance-mark-timezone`, base main
  `e4d799fdef1d0e17a579ca8c93091fb6cda33748`. Origin
  `https://github.com/rashadoni/leaddrive-v2.git`, production
  `13.140.132.245:/opt/leaddrive-v2`, release via reviewed main/GitHub Actions.
  `codex-project-context`, repository instructions and deployment route read.
- Protected read-only diagnostic run `38491406317` **PASS**, validated JSON
  artifact `11861628642`, serving SHA
  `ebd7dc90af73cca4b6d5d901bf1a170355d3e86b`. Both allowlisted fictional
  diagnostic operations reported Prisma `P2010`, SQLSTATE `23514`,
  `MTM_ATTENDANCE_MARK_EVENT_MISMATCH`. Expected columns/constraints exist,
  SELECT/INSERT privileges allowed, all three named migrations applied.
  No missing relation/column/record fields. `utcSession=false`.
- Source binds raw JavaScript Date values as timestamptz but inserts them into
  UTC timestamp-without-time-zone columns. Canonical events are ORM-written.
  Add explicit `AT TIME ZONE 'UTC'` after timestamptz casts for mark timestamps
  and the two historical branch lookup boundaries. Do not relax the canonical
  event trigger or change global/session production timezone.
- Added real shipping-route regression for two non-UTC zones, restricted
  NOBYPASSRLS role, NO_CONSENT START/FINISH, identical retries, exact canonical
  timestamps, no location, completed day and cross-tenant invisibility. Scratch
  role settings reset in finally; production connections are never used.
- Additional source finding sent to coordinator: the location history trigger
  writes `clock_timestamp()` into naive createdAt columns, shifting policy,
  consent and evidence timestamps in non-UTC sessions. In Asia/Baku a newly
  accepted consent may appear four hours in the future. This needs separate
  bounded migration evaluation; immutable history/backfill is out of scope.
- Next: hosted real-PG red/green against the unmodified writer and this patch;
  local checks limited to narrow syntax/contract checks. Full PG, TypeScript,
  browser and Android runs are **NOT RUN locally** under Contabo policy.
  No push, merge or production mutation by this worker.

## 2026-10-14 — first checkpoint ready for hosted red/green

- Source patch has five explicit UTC boundaries: claimedAt, serverReceivedAt,
  nullable fixCapturedAt, branch-history lookup and primary-branch lookup.
- Non-UTC real-PG regression also measures the raw cast's hour-sized drift and
  proves a forged one-millisecond mismatch still fails the database trigger.
  Two zones cover positive and negative UTC offsets. Receipt retries must leave
  exactly two canonical events/evidence rows, with no coordinates.
- Dedicated `.github/workflows/mtm-attendance-timezone.yml` runs on scoped PRs
  including drafts or manual dispatch. It loads only the original writer from
  production SHA ebd7 for the red phase and requires the exact production error
  signature in both cases. It restores the reviewed writer before running the
  entire existing location/privacy real-PG suite. Only a finite exact-SHA receipt
  is uploaded; no production data/secrets or raw error log artifact.
- Local narrow checks: TypeScript syntax for both touched TS files **PASS**
  (not a typecheck); **20/20** location/redaction unit tests **PASS** in 5.63 s;
  workflow YAML and shell syntax **PASS**; runner policy **PASS** for 65 workflows;
  whitespace **PASS**. Resource preflight roughly 14.3 GiB available, PSI zero.
- Real PG red/green, full TypeScript/build/browser gates are **NOT RUN locally**.
  Coordinator will review and push this first checkpoint. A separate follow-up
  will evaluate a forward-only UTC clock trigger migration with no history
  rewrite; coordinator explicitly authorized that investigation and coverage.
