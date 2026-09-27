# Workforce C6 exception-policy revision FK validation evidence — 2026-09-27

Status: **PRE-REVIEW / INACTIVE / NO PROGRESS CREDIT**

This bounded follow-up closes only the schema debt deliberately left by the
released inactive policy-revision foundation. It validates the existing
tenant-bound foreign key from exception decisions to policy revisions. It does
not add a policy writer, consumer, activation interval, feature flag, route,
worker, token issuer, provisioning path, terminal action or UI.

## Released starting point

PR #453 is deployed as exact `main` SHA
`330da758f9a5af22da5e6a33795530547e7e4f85`. Independent no-cache reads after
deploy returned `{"ok":true}` and the same exact `artifactSha`. The released
foundation creates the nullable decision field and an immediately enforced
composite foreign key with `NOT VALID`, so every post-migration non-null write
is checked while historical-table validation remains honest and separate.

## Production preflight status

A read-only catalog/size/lock query was attempted through the registered
`leaddrive-prod` alias before implementation. The alias resolved to the only
approved host, `13.140.132.245`, but its configured dedicated key was rejected
with `Permission denied (publickey)`. No SQL connected or ran and production
was not changed. Live catalog, row count, relation size, lock and autovacuum
state are therefore **NOT RUN**, not inferred from successful deploy.

The migration remains fail-closed without that observation: it has no DML,
uses a three-second lock-acquisition timeout and a two-minute statement bound,
and is one atomic transaction. A missing named constraint, an invalid row,
conflicting maintenance/DDL or an over-budget scan fails the deploy and
rolls the transaction back instead of weakening the key.

## Exact migration contract

`20260927093000_workforce_exception_policy_revision_validate` contains only:

1. `BEGIN`;
2. transaction-local `lock_timeout = '3s'`;
3. transaction-local `statement_timeout = '2min'`;
4. one exact `ALTER TABLE workforce_exception_decisions VALIDATE CONSTRAINT
   workforce_exception_decisions_policy_revision_fk`; and
5. `COMMIT`.

PostgreSQL uses `SHARE UPDATE EXCLUSIVE` for the validation scan, allowing
ordinary row reads and writes while serializing conflicting table maintenance
and DDL. A timeout is atomic. After inspecting a failed Prisma ledger row, the
operator can resolve this exact migration as rolled back and replay; validating
an already-valid key is safe. No column, index, row, grant, RLS policy or
trigger is created, altered or removed.

## Exact PostgreSQL proof

The already-blocking policy-revision PostgreSQL file now performs two distinct
Prisma deploys under the production-shaped `NOSUPERUSER + BYPASSRLS`
migration login, with DDL authority only through relation-owner membership:

- foundation deploy first proves `convalidated=false` and honest legacy NULL;
- two tenant-scoped policy rows are inserted through the non-bypass application
  role;
- a valid same-tenant non-null decision link is inserted before validation;
- only then is the validation migration added to the temporary migration tree
  and applied through `prisma migrate deploy`;
- afterward `convalidated=true`, both target ledger rows are successful and
  no target migration is unresolved;
- complete decision and policy-row JSON snapshots plus row counts are unchanged
  across validation;
- old-binary insert-without-field, valid same-tenant linkage and cross-tenant
  rejection still run after validation; and
- FORCE RLS, read/append-only grants and append-only update/delete/table-clear
  rejection remain covered after validation.

The file is already wired into both PR and deploy workflows beside the shared
lock PostgreSQL suite, so no workflow expansion or new bypass is required.

## Current local evidence

- PASS — migration/source contract: 5 tests.
- `SKIPPED / NOT RUN` — exact PostgreSQL: 5 tests, because no approved local
  scratch URL is present. CI execution remains mandatory.
- PASS — C13 compatibility contract: 8 tests.
- PASS — targeted ESLint for both changed TypeScript test files.
- PASS — Prisma schema validation with a non-connecting validation URL.
- PASS — RLS context scan: 553 organization-scoped models / zero gaps.
- PASS — runner policy for 37 workflows.
- PASS — event/delivery assets for 27 domains, 86 topics and five schemas.
- PASS — main-protection configurator.
- The first dependency-cache attempt did not start because that cache lacked
  the Vitest executable; it is `NOT RUN`, not a failed test. A separate
  read-only cache with the exact package-lock SHA then produced the PASS/SKIP
  results above; no install or foreign-worktree edit occurred.
- NOT RUN on Contabo — full typecheck/build, browser E2E, Android/Gradle, load,
  physical-device and human-pilot checks.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Validation
closes technical schema debt but does not complete WF-C6-002 or any user-visible
or terminal capability. A clean checkpoint, author-independent frozen review,
receipt-integrity review, five exact-head GitHub contexts, normal merge/deploy
and exact-SHA public smoke remain mandatory.

## Independent frozen-diff review

The clean source checkpoint is
`c1bb838c22d079486207a6463bfa17f286314a6e` over exact base and merge-base
`330da758f9a5af22da5e6a33795530547e7e4f85`. Its seven-file binary diff is
37,911 bytes with SHA-256
`6047e13f0f9c1f6fc8b8c88463dd79ff290b97d22394a3ed3ffc6b48729b08d7`.

A fresh author-independent read-only reviewer verified that identity, read the
complete diff and returned GREEN with zero P0-P3 findings. The review confirmed
the atomic fail-closed validation and replay contract, the two distinct Prisma
phases, unchanged full row snapshots, successful migration ledger state,
post-validation tenant/RLS/grant/append-only invariants, honest production
`NOT RUN` evidence and the complete absence of a writer, consumer, activation,
terminal action or UI. Reviewer-side `git diff --check` passed. Reviewer-side
real PostgreSQL, full typecheck/build, browser, Android and load checks were
`NOT RUN`; the real PostgreSQL proof and all five exact-head GitHub contexts
remain mandatory before merge. No progress credit is added.
