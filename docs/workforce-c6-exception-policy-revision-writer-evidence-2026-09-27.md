# Workforce C6 dormant exception-policy revision writer evidence — 2026-09-27

Status: **FROZEN COMPLETE-DIFF REVIEW GREEN / INACTIVE / EXACT-HEAD CI
PENDING / NO PROGRESS CREDIT**

This bounded slice starts from exact deployed `main` SHA
`0a71fc31967adc2683b6f481f59e516e71ed111c`. It adds only a
transaction-scoped primitive that can append a tenant acknowledgement of the
already owner-approved `recommended-v1` draft. There is no route, UI, worker,
provisioner, feature flag, effective window, decision linkage, terminal action
or tenant activation.

## Server-owned policy identity

The caller can supply only `organizationId`, an opaque `operationId` and the
accountable `recordedByUserId`. The writer constructs every policy field on
the server:

- version `recommended-v1`;
- the exact immutable `WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1`;
- canonical SHA-256
  `5651ee6048857f0c62219176dc1e17d411d0769a835be994a1d0cebbf4291c5a`;
  and
- reason code `TENANT_RECORDED_DRAFT`.

No caller-controlled definition, hash, version, free-form reason, timestamp or
revision is accepted. The definition still contains
`activation: DRAFT_ONLY_NO_TENANT_EFFECT`. The immutable revision row itself
is the canonical audit fact: tenant, actor, operation, reason, revision, exact
hash and database timestamp are retained together.

## Authorization, serialization and replay

- An injected `POLICY_REVISION_APPEND` authorization decision must succeed
  before the first lock or database call. A future caller must bind this to the
  existing tenant-wide `WORKFORCE_POLICY_DRAFT_WRITE` authority and supply an
  already tenant-scoped transaction.
- One PostgreSQL advisory transaction lock serializes the complete policy
  revision stream for an organization before replay resolution or revision
  allocation.
- The writer reads at most 65 ordered rows, validates the complete stream with
  the released fail-closed resolver, and permits at most 64 revisions. A gap,
  mixed/unsupported payload, source/hash drift or overflow blocks the write.
- An exact operation replay returns the original ID/revision without another
  insert. Reusing the operation for another actor or server-owned payload is a
  controlled conflict.
- A residual Prisma `P2002` maps to conflict without querying the already
  aborted PostgreSQL transaction. FK, RLS and other storage failures propagate
  unchanged.

The writer never reads or writes exception decisions, never fills
`policyRevisionId`, and never takes a case/decision lock. Decision linkage and
its cross-stream lock order remain separate reviewable work.

## Real PostgreSQL contract

The already blocking policy-revision PostgreSQL file is extended without a
workflow change. Under the production-shaped application role
`NOSUPERUSER + NOBYPASSRLS` and FORCE RLS, it must prove:

- a first transaction visibly owns the tenant advisory lock while a second
  application transaction is observed in `pg_stat_activity` waiting on an
  advisory lock;
- two concurrent distinct operations commit as contiguous revisions without a
  gap;
- two concurrent identical operations persist one row and return one create
  plus one exact idempotent replay with the same ID/revision;
- the ordered tenant stream remains contiguous; and
- the complete decision count and non-null policy-link count are unchanged.

The existing exact file continues to prove same-tenant actor ownership,
cross-tenant rejection, old-binary compatibility, validated decision FK,
FORCE RLS, read/append-only grants and owner-level update/delete/table-clear
rejection.

## Early independent preflight finding and repair

The author-independent pre-check found one P2 in the new PostgreSQL harness.
The first version asserted the observed advisory wait and second-transaction
state before releasing the test-only hold on the first transaction. A failed
assertion could therefore strand both transactions until timeout and obscure
the real failure with secondary unhandled errors.

The repaired harness attaches `Promise.allSettled` before observation, captures
the wait result and second-transaction state, releases the hold unconditionally
in `finally`, awaits both transactions, and only then asserts the observation
and append results. No writer behavior changed. The focused suite and ESLint
pass after the repair. Read-only preflight rereview returned GREEN with zero
remaining P0-P3 findings and made no changes. This is not the later mandatory
frozen complete-diff review, which remains separate after the clean checkpoint.

## Current local evidence

- PASS — resolver, writer and no-production-consumer source contracts: three
  files / 28 tests.
- PASS — C13 compatibility contract: 8 tests.
- `SKIPPED / NOT RUN` — exact PostgreSQL: 6 tests because no approved local
  scratch URL is present; exact-head CI execution is mandatory.
- PASS — targeted ESLint for all five touched source/test files.
- PASS — Prisma schema validation with a non-connecting validation URL.
- PASS — recursive RLS context scan: 553 organization-scoped models / zero
  gaps.
- PASS — runner policy for 37 workflows, event/delivery assets for 27 domains,
  86 topics and five concrete schemas, and main-protection configurator.
- PASS — diff whitespace before the evidence checkpoint.
- The first test command did not start because this worktree intentionally had
  no dependency tree; it is `NOT RUN`, not a test failure. A temporary
  read-only cache with exact package-lock SHA
  `54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`
  then produced the PASS/SKIP results without an install or foreign edit.
- NOT RUN on Contabo — full typecheck/build, browser E2E, Android/Gradle, load,
  physical-device and human-pilot checks. Typecheck and exact PostgreSQL remain
  mandatory in GitHub CI; heavy/physical evidence remains delegated to its
  authorized environments.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. This dormant
writer closes no acceptance item by itself and does not make a policy
effective. A clean checkpoint, author-independent frozen complete-diff review,
receipt-integrity review, sub-400 KB PR, all five exact-head contexts, normal
merge/deploy and exact-SHA public smoke remain mandatory.

## Integration with current main

After the first clean source checkpoint, `origin/main` advanced from the
deployed PR #454 SHA to
`4e5afe8da053c187e5070fbedd157ade9382817b` through unrelated PR #455. Its six
paths contain only MTM compact-filter UI/tests and translations and do not
overlap this slice. The branch merged that exact main without conflict; the
older frozen identity was immediately withdrawn from final-review credit.

On the integrated tree, the focused selection again passes 36 tests with six
exact-PostgreSQL tests `SKIPPED / NOT RUN`. Targeted ESLint, Prisma validation,
RLS `553/0`, runner policy `37`, event assets `27/86/5`, main-protection tests,
diff whitespace and translation parity (23,587 English leaf keys; RU/AZ
missing=0 extra=0) pass. The temporary exact-lock dependency symlink is removed
before checkpointing. A new integrated identity and complete independent
review are required; no verdict from the superseded identity transfers.

## Independent frozen complete-diff review

The clean replacement identity is base/merge-base/current `origin/main`
`4e5afe8da053c187e5070fbedd157ade9382817b`, head
`db506b51a4e8c20b2a94524fdb5d00ac14b12755`, nine changed paths and 61,305
binary-diff bytes with SHA-256
`f74233dfe5827c5b0eaeefca31a16f3cd43b98bae8b2914faa9e2bb73cb2892a`.

A fresh author-independent read-only reviewer started from zero, read every
changed line and returned GREEN with zero P0-P3 findings. The review confirmed
release-receipt truth, tenant authorization/RLS, server-owned canonical policy
input, complete ordered history validation and 64-row bound, exact replay and
conflict behavior, no post-P2002 query, tenant advisory locking, deterministic
PostgreSQL proof cleanup, Prisma/runtime compatibility, no consumer/decision
link/activation and honest progress/scope evidence. PR #454 release facts and
the conflict-free PR #455 integration were independently corroborated.

Reviewer-side diff whitespace, translation parity (23,587/0/0), branch
protection configurator, event assets (27/86/5), runner policy (37) and the
production no-consumer scan passed. Reviewer-side exact PostgreSQL, full
typecheck/build, dependency-backed tests/lint/Prisma/RLS, browser, Android,
load and physical/pilot checks were `NOT RUN`; the primary's local checks and
mandatory exact-head CI remain separate evidence. This receipt-only delta must
receive its own integrity review before push.
