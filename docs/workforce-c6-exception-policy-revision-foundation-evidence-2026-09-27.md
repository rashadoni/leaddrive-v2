# Workforce C6 exception-policy revision foundation evidence — 2026-09-27

Status: **replacement complete-diff review GREEN; exact PostgreSQL and
exact-head CI pending**.

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

The repaired clean replacement identity is base/merge-base
`249466e9ac25eccecefc34b62563b328a8026817`, head
`3561a08877d1c865a3240cc06e000d5f604ebe5c`, 14 files / 79,022 bytes and
binary-diff SHA-256
`88375445e73dfb2bb0fb6cd9efb81e7f672d988ca93af25c9dc40b662f2788bb`.
A fresh author-independent review reread the complete diff and returned GREEN
with zero P0–P3 findings. It explicitly reconfirmed the repaired final
pre-`COMMIT` live ALTER block, the positive ordering guard, inactive boundary,
hash/resolver, Prisma/FK parity, RLS/append-only contract, old-binary NULL
compatibility, C13 fence, exact-PostgreSQL harness and blocking workflow
wiring. Reviewer-side diff, Prisma validation, RLS 553/0, runner 37, assets
27/86/5, main-protection and identity checks pass; dependency-backed tests,
ESLint, PostgreSQL and all heavy/physical gates remain `NOT RUN` reviewer-side.
This receipt-only documentation delta requires an independent integrity check
before publication.

## PR #453 exact-head gate failure and bounded capacity repair

Receipt-reviewed PR head `31e43ea48bcbd0dd7ba37a6e9a0c77b431eb9ed5`
entered run `36297739725`. `pr-scope`, `static-checks`, `runner-policy` and
`scan` passed; the static context executed the exact disposable-PostgreSQL
migration/RLS/old-binary proof successfully. The required `typecheck` context
did not pass, so merge was not attempted.

Both the original typecheck job `108559637786` and its failed-job-only rerun
`108562128928` reproduced Node exit 134 with no TypeScript diagnostic. The
second run reported old-heap use around 11,061.5 MiB against the former
11,264-MiB ceiling before `FATAL ERROR: ... heap out of memory`. The existing
gate correctly treated the crash as unverified and failed rather than reading
an empty diagnostic set as green.

The bounded repair changes only the full `tsc --noEmit` step from 11,264 to
12,288 MiB on the existing public `ubuntu-24.04` runner. It retains the exact
compiler command, `PIPESTATUS` capture, non-compiler-exit rejection and both
blocking diagnostic/baseline analyzers. A repository asset assertion now
extracts only the typecheck job and pins the hosted runner, exact bounded heap,
full compiler command and both gates. No application, migration, Prisma,
authorization or tenant behavior changed.

The repair checkpoint is
`44ef9df0efd3bc3593378995269bca3cb9eaa2a6`. From unchanged base/merge-base
`249466e9ac25eccecefc34b62563b328a8026817`, its complete 15-file / 85,293-byte
binary diff has SHA-256
`630559d59268f9863f01670e5a244d3adc96f75e9e02cf8b33c8911fba07be54`.
The two-file repair delta from `31e43ea48bcbd0dd7ba37a6e9a0c77b431eb9ed5`
is 2,772 bytes with SHA-256
`39df66c84e8b0c20429d30dbee877a2fbfffc9b96368424566ba699ae068acd1`.

A fresh author-independent complete-diff review returned GREEN with zero
P0–P3 findings. It reconfirmed the migration/Prisma/RLS/tenant-delete and
old-binary contracts as well as the fail-closed capacity repair. Reviewer-side
diff, event assets 27/86/5, runner policy 37, main-protection, RLS 553/0 and
Prisma validation checks pass. Exact-head CI/full typecheck, full build,
browser, Android, load and physical/pilot checks are `NOT RUN` for the repaired
head and remain mandatory.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. This repair
earns no task or gate credit. A receipt-only integrity review and all five
replacement exact-head GitHub contexts are required before merge.

## Reviewed production release

Receipt-integrity review confirmed final PR head
`732a4fe053d5e4e8e2af870766640953e7b5a613` with zero P0–P3 findings. The
complete diff from base/merge-base
`249466e9ac25eccecefc34b62563b328a8026817` remained 15 files / 91,603 bytes
with SHA-256
`3929b76f5bcd400400d6e519fba1342c49d0d56ac121c291f7ccf5a38eb9df8e`.
No source, migration, schema, workflow or test path changed after the complete
source review.

Exact-head run `36300723671` passed all five required contexts: `pr-scope`,
`static-checks`, `typecheck`, `runner-policy` and `scan`. `static-checks`
repeated the exact PostgreSQL migration/RLS/old-binary proof. The repaired full
typecheck completed in 16m21s and passed both blocking analyzers; the heap
repair therefore has positive execution evidence rather than only source
inspection.

PR #453 merged normally at `2026-09-27T06:57:03Z` as
`330da758f9a5af22da5e6a33795530547e7e4f85`. Push deploy run `36301608281`
completed GREEN at `2026-09-27T07:21:28Z`: quality/security, standalone build,
SHA-bound artifact publication, atomic production deployment, workflow smoke
and retained-artifact cap all passed through the documented route.

Independent no-cache public reads returned `{"ok":true}` from
`/api/v1/ping` and
`{"sha":"330da758f9a5","artifactSha":"330da758f9a5af22da5e6a33795530547e7e4f85","builtAt":"2026-09-27T07:02:50Z"}`
from `/api/v1/public/build-info`. The artifact SHA exactly matches merged
`main`.

Full local build, browser E2E, Android/Gradle, load, physical-device and human
pilot checks remain `NOT RUN` on Contabo and are not inferred from this
release. Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%: the
released inactive foundation has no writer, activation, terminal action or UI.

The next bounded slice is a separate validation of the deliberately `NOT
VALID` decision-policy FK, subject first to read-only production-catalog and
table-size preflight. It earns no task/gate credit and must not add a writer or
consumer.
