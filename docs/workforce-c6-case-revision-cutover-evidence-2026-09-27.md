# Workforce C6 case-revision cutover evidence — 2026-09-27

Status: **first frozen review RED; both findings repaired; replacement
complete-diff review and exact-head CI pending**.

This slice starts from deployed `main` SHA
`fdc601599b048734409a1359863ede382d08e768` plus the append-only release
receipt checkpoint. It replaces cross-table timestamp comparison in the
exception lifecycle with one case-local logical revision. It does not expose,
enable or activate terminal resolution/reopen actions and adds no roadmap or
phase-gate credit.

## Why timestamps are not a causal boundary

The prior workbench compared decision `createdAt` with employee-response
`submittedAt` and correction-request `createdAt`. That is insufficient for a
terminal lifecycle:

- employee response timestamps can originate from a client and are therefore
  not trusted ordering facts;
- PostgreSQL `now()` is fixed at transaction start, so a transaction that
  starts first, waits on the case advisory lock and writes last can carry an
  earlier timestamp than the reset/reopen decision it causally followed; and
- the same transaction-start inversion can affect two decision timestamps.

All authorization-sensitive ordering now comes from an integer revision
allocated under the canonical
`workforce-exception-decision:<organizationId>:<caseId>` advisory transaction
lock.

## Storage and write invariants

- Every `WorkforceExceptionDecision` has a positive `caseRevision`, unique by
  organization and case. Both generic and policy decision writers validate a
  contiguous bounded history under the case lock and append exactly `N + 1`.
- A new employee response stores `observedCaseRevision`; a new linked web or
  mobile correction request stores `exceptionCaseRevision`. The value is the
  post-lock stream revision observed in the same transaction.
- The employee-response database trigger requires a correction request to be
  linked to the exact same case, employee and workday. A same-day request for
  another case, including an unlinked request, cannot be used as a correction
  response source.
- Response and request signal revisions are immutable/current at insert. A
  nullable value is retained only for rolling-deploy compatibility and legacy
  rows; lifecycle logic treats it as unknown and never infers authority from a
  timestamp.
- Exact idempotent replays remain before lifecycle validation. A completed
  retry is therefore stable while changed or genuinely new writes fail closed.

## Online migration contract

The cutover uses four separately tracked Prisma migrations so a later timeout
never leaves an earlier successful phase hidden inside one failed ledger row:

1. `20260927014000_workforce_exception_case_revisions` is a short atomic
   metadata expansion. It adds nullable columns and `NOT VALID` constraints,
   then installs the decision allocator and signal validators. A draining old
   binary can omit every new revision field. Decision inserts allocate after
   both NULL legacy rows and revisioned rows; response and linked-request
   inserts use the full decision count, including the expand-before-backfill
   window. Under the same case lock, the bridge also advances decision
   `createdAt`, response `createdAt` and linked-request `submittedAt` past every
   prior lifecycle event, so the deployed timestamp reader and revision reader
   agree during drain or rollback.
2. `20260927014100_workforce_exception_case_revisions_backfill` is an atomic,
   two-minute-bounded backfill that ranks only NULL legacy decisions by the
   former deterministic `(createdAt, id)` order. The append-only trigger is
   never disabled. Its transaction-local replacement admits only a
   NULL-to-positive `caseRevision` change when every other column is unchanged
   and `session_user` is a member of the relation-owner role. Every other update
   or delete remains rejected, and failure atomically rolls the data and
   temporary function definition back.
3. `20260927014200_workforce_exception_case_revisions_indexes` builds the
   unique decision index and response lookup index with `CREATE INDEX
   CONCURRENTLY` outside an explicit transaction. Before each build it uses
   `DROP INDEX CONCURRENTLY IF EXISTS`, so a verified failed Prisma ledger row
   and PostgreSQL's same-named invalid index can be resolved and replayed.
4. `20260927014300_workforce_exception_case_revisions_contract` atomically
   scans constraints with `VALIDATE CONSTRAINT`. A validated helper proves
   non-nullness before the final short metadata-only `SET NOT NULL`.

No long scan or index build runs while an explicit `ACCESS EXCLUSIVE` lock is
held. A timeout fails deployment without exposing terminal actions; the
already-expanded schema remains compatible with the old application binary.
Once revisioned facts exist, rollback must retain the added columns, triggers
and indexes.

## Revision-based readers

The following lifecycle consumers now order and validate the contiguous
decision stream by `caseRevision`:

- manager exception queue and action-token projection;
- exception report lifecycle classification;
- timesheet approval blockers;
- terminal decision context reconstruction; and
- the shared linked-mutation lifecycle guard.

The workbench recognizes a response/request only when its stored revision is
at or after the latest request/reopen boundary. NULL, negative, non-integer,
future, duplicate or gapped revisions fail closed. Timestamp fields remain
presentation/audit facts only. Historical response counts and the employee's
non-terminal response badge do not authorize an action.

## Exact PostgreSQL proof

`src/__tests__/lib-workforce-exception-lock-postgres.test.ts` now applies the
exact migration SQL to a non-empty scratch schema. The applying login is
`NOSUPERUSER + BYPASSRLS`, owns relations only through membership in a
separate owner role, and backfills a ledger with `ENABLE/FORCE ROW LEVEL
SECURITY`. This matches the production deployment privilege boundary rather
than relying on the CI superuser.

The harness invokes the real `prisma migrate deploy` command. It first deploys
only expansion, writes old-binary request/response rows while all three legacy
decisions are still NULL, and proves that both rows bind to revision 3 in
strict timestamp order. It then deploys backfill, deliberately creates one
duplicate revision, observes one failed Prisma index-migration ledger row plus
one same-named invalid index, removes only the injected fault, executes the
exact `prisma migrate resolve --rolled-back` recovery, and replays deployment
to four successful migration rows with no unresolved entry. Its three
lifecycle timestamp columns use the exact production `TIMESTAMP(3)` type and
default semantics.

The eleven opt-in PostgreSQL cases cover:

- expand-before-backfill old-writer compatibility, deterministic append-only
  backfill, restored mutation rejection, Prisma-ledger/invalid-index recovery,
  old-client omission, correct and stale explicit revisions,
  exact/legacy/stale signal semantics, same-case correction success,
  wrong/unlinked-case rejection and unrelated request-status updates
  preserving the revision;
- a decision allocator that waits on the advisory lock and reads the committed
  winner from a fresh snapshot;
- response and request trigger validation after an observed advisory-lock wait;
- both terminal/linked mutation orders;
- timestamp inversion while the stored logical revision preserves causality;
- the global `workday -> case` order;
- cross-case employee response, HR request and decision-operation uniqueness
  fences; and
- exact submit/cancel replay visibility after a lock wait.

The suite is already a blocking step in PR and deploy CI. It is skipped unless
the dedicated disposable PostgreSQL URL is present.

## Local evidence

- PASS — Prisma schema validation with an explicit validation URL.
- PASS — focused Vitest selection: 12 files / 226 tests passed.
- SKIPPED / NOT RUN locally — the thirteenth selected file contains 11 opt-in
  PostgreSQL cases and no approved scratch URL is present; exact Prisma-ledger
  recovery, production-like role/RLS and races remain mandatory in CI.
- PASS — targeted ESLint for every changed TypeScript/test file.
- PASS — recursive RLS context scan: 552 organization-scoped models, zero
  gaps.
- PASS — runner policy for 37 workflows, event/delivery assets for 27 domains,
  86 topics and five concrete schemas, and main-protection configurator tests.
- PASS — `git diff --check` before the documentation checkpoint.
- NOT RUN — Prisma generate against the shared dependency cache, because it
  would mutate a foreign cache; CI must generate the client.
- NOT RUN under the Contabo workload policy — full typecheck/build, browser
  E2E, Android/Gradle, load, physical-device and human-pilot checks.

The first author-separated frozen review returned RED with two P1 findings: a
draining old timestamp reader could disagree with the revision reader, and the
single multi-phase migration could not be safely replayed from a later failed
Prisma ledger row. The compatibility timestamp/revision bridge and four
separately tracked restartable phases above are the repairs. A fresh review of
the replacement frozen diff and all five exact-head GitHub contexts
(`pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan`) remain
mandatory before merge. The retired `agent-review` GitHub status is not
restored. A separate pre-freeze audit found and repaired one P2 fixture-fidelity
issue (`TIMESTAMPTZ` versus production `TIMESTAMP(3)`); its rereview returned
zero remaining findings, but it is not substituted for the mandatory frozen
complete-diff review.

Progress remains `81/161`, phase gates remain `14/15`, C5 remains 81%, C6
remains 20% and C9 remains 99%. Terminal resolution/reopen, visible terminal
UI and tenant activation remain separately open.
