# Workforce C6 case-revision cutover evidence — 2026-09-27

Status: **PR #452 exact-PostgreSQL online-index proof passed in CI; a subsequent
C13 additive-contract finding is repaired locally, with fresh review and
replacement exact-head CI pending**.

This slice starts from deployed `main` SHA
`fdc601599b048734409a1359863ede382d08e768` plus the append-only release
receipt checkpoint. It replaces cross-table timestamp comparison in the
exception lifecycle with one case-local logical revision. It does not expose,
enable or activate terminal resolution/reopen actions and adds no roadmap or
phase-gate credit.

## Why timestamps are not a causal boundary

The prior workbench compared decision `createdAt` with employee-response
`createdAt` and correction-request `submittedAt`. That is insufficient for a
terminal lifecycle:

- a mobile correction request's `submittedAt` can originate from the client and
  is therefore not a trusted ordering fact;
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

## Online and bounded migration contract

The cutover uses five separately tracked Prisma migrations so a later failure
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
3. `20260927014200_workforce_exception_case_revisions_decision_index` contains
   exactly one SQL statement: the concurrent unique decision-index build.
4. `20260927014250_workforce_exception_case_revisions_response_index` likewise
   contains exactly one concurrent response-index build. Prisma submits a
   multi-statement file in an implicit transaction block, where PostgreSQL
   prohibits `CONCURRENTLY`; separating the two one-statement files keeps both
   builds outside that block and lets ordinary writes continue. A failed build
   can leave one invalid same-named index. Recovery first proves its exact
   table, uniqueness and ordered columns, drops only that index with a separate
   `DROP INDEX CONCURRENTLY`, marks only that migration rolled back and replays
   it. There is deliberately no false SQL-level whole-phase timeout claim;
   cancellation/failure stops deployment and follows the same verified invalid
   artifact path.
5. `20260927014300_workforce_exception_case_revisions_contract` atomically
   scans constraints with `VALIDATE CONSTRAINT`. A validated helper proves
   non-nullness before the final short metadata-only `SET NOT NULL`.

No long scan or index build runs while an `ACCESS EXCLUSIVE` or ordinary
write-blocking index-build lock is held. Failure never exposes terminal actions;
the already-expanded schema remains compatible with the old application binary
while a reviewed retry resolves the exact failed index phase. Once revisioned
facts exist, rollback must retain the added columns, triggers and indexes.

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

The harness invokes the real `prisma migrate deploy` command. It first
registers one test-only no-op baseline marker with the real `prisma migrate
resolve --applied` command. The fixture deliberately creates the production-like
tables before Prisma runs; the marker models the already populated production
ledger without marking any of the five target migrations applied. The harness
then deploys only expansion, writes old-binary request/response rows while all
three legacy decisions are still NULL, and proves that both rows bind to
revision 3 in strict timestamp order. It next deploys backfill, deliberately
creates one duplicate revision, observes exactly one failed Prisma
index-migration ledger row whose log identifies SQLSTATE `23505` and the exact
unique index. It proves PostgreSQL left exactly one invalid index with the
expected table, uniqueness and ordered columns, removes only the injected data
fault, and has the production-like non-superuser migration role drop that exact
artifact through a standalone `DROP INDEX CONCURRENTLY`. It then executes the
exact `prisma migrate resolve --rolled-back` recovery and replays deployment to
five successful migration rows with no unresolved entry. The replay additionally
proves both indexes are valid, ready, have the expected uniqueness and exact
ordered columns. Its three lifecycle timestamp columns use the exact production
`TIMESTAMP(3)` type and default semantics.

The eleven opt-in PostgreSQL cases cover:

- expand-before-backfill old-writer compatibility, deterministic append-only
  backfill, restored mutation rejection, exact uniqueness-failure ledger and
  exact invalid-index cleanup/replay,
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
complete-diff review. The first replacement frozen review then found one P3 in
this evidence text: it had transposed response/request timestamp field names
and attributed client time to the response rather than the mobile correction
request. The factual wording above is repaired; no runtime or migration logic
changed. The replacement identity and verdict are recorded below.

The replacement review independently verified clean base/merge-base
`fdc601599b048734409a1359863ede382d08e768` through head
`55e0b12aa51766375c7f587f5930b9f841cb7310`: 32 files, 191,101 bytes and
binary-diff SHA-256
`0cb01f3e46e39e3fa430d8a186a0ca9495f8a0550a1973846008a6fdff73b809`.
Its fresh full-diff verdict is GREEN with zero P0–P3 findings. The reviewer
also repeated Prisma validation and the 12-file / 226-test local selection;
the 11-case real-PostgreSQL file remained correctly skipped without an
approved URL. This append-only review receipt is not part of that frozen head
and therefore requires a separate read-only integrity confirmation before
publication.

That receipt-only delta was independently confirmed GREEN at final published
head `9e60bce04b5303d7c742ed69c16c26f4b8331048`; it changed exactly these three
documents and no source, workflow, migration or test file. PR #452 exact-head
run `36286354272` then passed `pr-scope`, `runner-policy` and `scan`, while
`static-checks` correctly failed the new real-PostgreSQL harness with Prisma
`P3005`. The fixture had pre-created a non-empty production-like schema but no
existing Prisma ledger, unlike production. The test-only baseline marker above
uses Prisma's supported baselining path before the four exact target
migrations. The 13-file local selection still passes 226 tests with the 11
PostgreSQL cases skipped, and exact-test ESLint passes. This test-source repair
supersedes the prior reviewed identity; fresh review and all five replacement
exact-head contexts are required. No gate is reclassified or weakened.

Fresh author-independent review of the repaired clean tree returned GREEN with
zero P0–P3 findings. It verified base/merge-base
`fdc601599b048734409a1359863ede382d08e768`, head
`576cdf62027120ad37c311eca379cffa4a495754`, 32 files, 199,903 bytes and
binary-diff SHA-256
`e494fb92be01589e60bb89d611ac6080cb7e1d3305b251f69046d841ad6eb2d2`.
The reviewer reconfirmed the complete runtime/migration patch and proved that
the no-op baseline exists and is resolved before any target directory is added,
cannot satisfy the target-only `4 successful / 0 unresolved` assertion, and
does not weaken the failed-index recovery. Reviewer-side Prisma validate, 226
tests and targeted ESLint pass; 11 real-PostgreSQL scenarios remain `NOT RUN`
locally. The failed old-head run subsequently completed `typecheck` GREEN in
19m58s, but that result is not transferred to the repaired head. This review
receipt requires a docs-only integrity check before push, followed by all five
replacement contexts.

The receipt-only delta was subsequently confirmed GREEN and published as head
`cdddfb507d17c38b767f5f7341ed0791d6763170`. Replacement run `36287749135`
passed `pr-scope` and `typecheck` (17m23s); the companion `runner-policy` and
`scan` runs also passed. `static-checks` correctly blocked the release in the
real-PostgreSQL gate. PostgreSQL's service log proves the old multi-statement
index file failed on its first command with `DROP INDEX CONCURRENTLY cannot run
inside a transaction block`; it therefore recorded one failed Prisma row but
created no invalid index. The failure happened before the injected duplicate
could exercise uniqueness, so merely accepting zero invalid indexes would have
weakened the gate.

The first repair replaced that false execution model with an atomic ordinary
index transaction. Frozen review of head
`77257d11656506c201ac445bcb6e2b39f4c48fe3` correctly returned RED with one P2:
the old application remains live during `migrate deploy`, so two ordinary
builds could block writes despite the momentary quiet-window sample, contrary
to `MIGRATION_RUNBOOK.md`; its two-minute timeout was also per statement rather
than for the whole phase. That identity was never pushed.

The current repair is the two one-statement concurrent phases and exact
invalid-index recovery described above. It removes the blocking build, the
64 MiB surrogate and the false timeout claim rather than weakening the test.
The full 13-file local selection passes 226 tests with the 11 real-PostgreSQL
cases `SKIPPED / NOT RUN`; both changed test files pass ESLint, Prisma
validation, RLS 552/0, runner policy 37, event assets 27/86/5, protection tests
and diff whitespace pass. The rejected production SSH size probe provides no
evidence and is no longer used as a safety premise. This source/migration
change supersedes every earlier GREEN identity: fresh author-independent
review, receipt integrity and all five replacement exact-head contexts are
required.

## Online-split independent review receipt

Fresh author-independent review froze base/merge-base
`fdc601599b048734409a1359863ede382d08e768` and head
`e7efdab38992abe28660b0527c9f74362b706074`. The complete 33-file binary diff
was 225,549 bytes with SHA-256
`b3d5d57e4a70f42474db9f6957e9a5afc97fa038094b6361b73569fbfb55e03c`.
The verdict was **GREEN with zero P0-P3 findings** after review of the complete
runtime, tenant/RLS/auth, idempotency, revision-continuity, terminal-fence,
five-phase migration and append-only evidence surfaces.

The reviewer independently confirmed both concurrent-index files contain
exactly one executable statement, the P3005 baseline and SQLSTATE `25001`
failures remain addressed without weakening the gate, and the opt-in
PostgreSQL harness requires exact `23505`, one exact invalid unique index,
standalone cleanup by the production-like `NOSUPERUSER + BYPASSRLS`
owner-member, exact-row rollback resolution, five successful migrations and
two exact valid/ready indexes. Reviewer-side `git diff --check`, runner policy
(37 workflows), RLS scan (552 organization-scoped models / 0 gaps), event
assets (27 domains / 86 topics / 5 schemas), main-protection configurator and
final identity/cleanliness checks passed. Real PostgreSQL, full build/typecheck,
browser E2E, Android, load and physical/pilot gates were not run by the reviewer;
the relevant exact-head CI contexts remain mandatory.

## C13 additive-contract CI repair

Replacement run `36290997196` on exact head
`405342e648e397d5b1ce7bfe4c305ae0f1f659ff` passed `pr-scope`,
`typecheck` (16m45s), `runner-policy` and `scan`. Inside `static-checks`, the real PostgreSQL
`Workforce exception shared-lock PostgreSQL race gate` passed: this is the
first execution evidence that the two one-statement concurrent phases,
`23505` invalid-index proof, standalone cleanup, exact ledger resolution and
five-migration replay all work together. The context nevertheless failed later
because the repository-wide C13 compatibility test lexically rejected the
intentional phase-2 `UPDATE`.

The failure is not baselined away. `WF-C13-001` prohibits destructive
backfills, while this phase fills only a newly added structural revision
ordinal derived from the immutable decision ledger. The repaired C13 contract
still rejects every `UPDATE` in every other Workforce migration and names only
the exact revision-backfill phase. For that phase it positively requires one
top-level update, the exact table/column, stable tenant/case ordering,
NULL-only source/target predicates, transaction/lock/statement bounds, the
explicit backfill setting, relation-owner membership, all-other-column
equality, two guard-function definitions and an uninterrupted append-only
trigger. Any second migration or broader mutation remains a CI failure. The
C13 ADR records this narrow amendment instead of silently weakening its
historical-assurance rule.

The repaired 14-file local selection passes 234 tests with the 11 opt-in
PostgreSQL tests `SKIPPED / NOT RUN`; the changed contract passes ESLint. The
previous exact-head PostgreSQL success is diagnostic evidence only: all five
contexts, complete-diff review and receipt integrity must rerun on the eventual
replacement head.

Progress remains `81/161`, phase gates remain `14/15`, C5 remains 81%, C6
remains 20% and C9 remains 99%. Terminal resolution/reopen, visible terminal
UI and tenant activation remain separately open.
