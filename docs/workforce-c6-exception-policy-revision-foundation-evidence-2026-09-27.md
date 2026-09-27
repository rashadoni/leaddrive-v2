# Workforce C6 exception-policy revision foundation evidence — 2026-09-27

Status: **first frozen review P2 repaired locally; replacement independent
review and exact PostgreSQL CI pending**.

This bounded slice starts from deployed `main` SHA
`249466e9ac25eccecefc34b62563b328a8026817` plus its append-only release
receipt. It creates durable provenance for the already owner-approved
`recommended-v1` exception-policy draft. It does not activate a policy,
tenant, terminal decision, notification, scheduler, route, writer or UI and
adds no roadmap or phase-gate credit.

## Policy identity boundary

- `WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1` remains the sole supported
  definition and still contains `activation: DRAFT_ONLY_NO_TENANT_EFFECT`.
- Recursive sorted-key canonical JSON plus SHA-256 pins its exact literal hash
  as `5651ee6048857f0c62219176dc1e17d411d0769a835be994a1d0cebbf4291c5a`.
- The pure resolver validates the complete caller-supplied stream. Empty,
  gapped, reordered, mixed-tenant, duplicate, malformed, unknown-version,
  unknown-hash or definition-drift history fails closed.
- A successful resolution is explicitly `VALID_DRAFT`. It selects no
  effective window, authorizes no action and performs no database read/write.
  No production module imports the resolver in this foundation.

## Additive storage contract

Migration
`20260927070000_workforce_exception_policy_revision_foundation` adds an empty
`workforce_exception_policy_revisions` ledger with:

- tenant-scoped ID, positive revision and idempotency operation uniques;
- exact version, JSON definition and lower-case SHA-256 fields;
- accountable same-tenant user, bounded reason code and recorded timestamp;
- tenant-first indexes, composite actor FK and organization cascade;
- `ENABLE/FORCE ROW LEVEL SECURITY` with only tenant/bypass select and insert;
- owner-level rejection of direct row update/delete and direct table clearing;
  the only delete admitted by the trigger is a nested organization cascade;
  and
- application relation-owner privileges limited to `SELECT, INSERT`.

`WorkforceExceptionDecision.policyRevisionId` is additive and nullable with no
default or backfill. Its composite `(organizationId, policyRevisionId)` FK is
`NOT VALID`: every new non-null link is enforced immediately, while validation
of the live table remains a separately bounded future phase. An old binary can
continue inserting a decision without the field, and old decisions remain
honestly unbound. The relation is provenance, not an authorization bit.

No decision-table index is built in this phase: an ordinary live-table build
would violate the online migration boundary, while the dormant foundation has
no reverse-query consumer. Any later index must be its own reviewed concurrent
phase before a consumer exists.

## C13 compatibility amendment

The existing C13 contract rejected every lexical occurrence of the table-clear
operation, including a statement trigger that rejects that operation. The
amendment names only this migration, requires exactly the `TG_OP`, rejection
message and `BEFORE` guard occurrences, and still rejects an executable
top-level destructive command. Every other Workforce migration remains
forbidden from containing the token. No reusable migration exception, seed,
backfill or data rewrite was added.

## Exact PostgreSQL proof boundary

`lib-workforce-exception-policy-revision-postgres.test.ts` builds a disposable
production-shaped schema, registers a test-only existing-schema baseline and
applies the exact migration with the repository Prisma CLI. The applying login
is `NOSUPERUSER + BYPASSRLS` and receives DDL authority only through membership
in a separate relation-owner role. A different `NOSUPERUSER + NOBYPASSRLS`
application role owns the baseline `mtm_agents` relation and receives the
migration's exact read/append grant.

The blocking proof checks:

- the ledger is empty immediately after apply;
- the existing decision remains `policyRevisionId=NULL` and the new live-table
  FK is deliberately unvalidated;
- FORCE RLS plus tenant select/insert isolation;
- same-tenant actor and decision-policy composite FKs;
- old-binary decision insert compatibility and valid new nullable linkage;
- cross-tenant row, actor and policy-link rejection; and
- update, delete and table-clear rejection even for the migration owner.

Both PR and deploy workflows run this file beside the existing shared-lock
PostgreSQL suite under the disposable PostgreSQL service. The test skips when
that explicit URL is absent; local skip is not execution evidence.

## Current local evidence

- PASS — 4 dependency-backed files / 32 tests; the PostgreSQL file / 4 tests
  is `SKIPPED / NOT RUN` because no approved scratch URL is present locally.
- PASS — targeted ESLint for all five changed TypeScript/test files.
- PASS — Prisma schema validation with an explicit non-connecting validation
  URL.
- PASS — recursive RLS scan: 553 organization-scoped models / zero gaps.
- PASS — runner policy for 37 workflows and event/delivery assets for 27
  domains, 86 topics and five concrete schemas.
- PASS — diff whitespace before the evidence checkpoint.
- NOT RUN locally — exact migration/PostgreSQL/RLS execution; mandatory in CI.
- NOT RUN on Contabo — Prisma generate against the foreign shared cache, full
  typecheck/build, browser E2E, Android/Gradle, load, physical-device and human
  pilot checks. CI/heavy or physical environments remain authoritative.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. A clean
checkpoint, frozen complete-diff independent review, receipt-integrity review
and all five exact-head GitHub contexts remain mandatory before merge.

## First frozen review and repair

The author-independent review of exact clean base/merge-base
`249466e9ac25eccecefc34b62563b328a8026817` through head
`d12e51ca1e1e63152750724b535b8c639e555d0a` returned RED with one P2 and no
other P0–P3 findings. Its full 14-file / 74,663-byte binary diff had SHA-256
`98327071b478951cfd6c619e334606abb55b4507283dadcca4255bbb07669c92`.

The decision-table nullable-column and `NOT VALID` FK alterations acquired a
live-table lock before roughly seventy lines of unrelated new-table trigger,
RLS, policy and grant DDL. PostgreSQL retains that lock until transaction
commit, while the statement timeout does not bound the whole transaction. The
repair moves both live-table alterations after all new-table-only work into the
final pre-`COMMIT` block. A positive source assertion now requires that order
and exact tail shape. Focused tests, ESLint and Prisma validation pass again;
the changed identity still requires a fresh complete-diff review and no GREEN
credit transfers from the rejected head.
