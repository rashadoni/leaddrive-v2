# C12 operational schema contract — bounded supplement

The existing reader-profile matrix records operational constraints without
asserting their complete identity. This supplement checks the exact dormant
`workforce_reconciliation_tenant_states` catalog contract independently. It does
not change the migration, application, reader admission, grants, scheduler or
existing production metadata gate. WF-C12-008 and C12 remain PARTIAL.

## Fixed read-only observation

[`scripts/workforce-reconciliation-schema-contract.sql`](../scripts/workforce-reconciliation-schema-contract.sql)
uses one Repeatable Read, read-only transaction with ten-second statement and
two-second lock bounds, trusted search path and rollback. It reads only catalogs,
returns13 fixed booleans and reveals no expressions, table data, role names,
identifiers or counts. A catalog-visible nonsuperuser with no SELECT on business
tables can execute it; this adds no authorization or production execution route.

The contract requires PostgreSQL16, an ordinary permanent table, exactly11
columns in migration order with builtin types/precision/nullability/collation,
the exact seven defaults and no unexpected defaults, an immediate valid unique
tenant primary key (there is no `id` column), a validated immediate foreign key
to `organizations.id` with DELETE CASCADE and active builtin enforcement triggers,
all five validated CHECKs with exact ranges/outcomes, ENABLE/FORCE RLS, the sole
PUBLIC permissive ALL tenant policy with exact USING and WITH CHECK, and both
valid unfiltered builtin btree indexes in the exact order. Unexpected user
triggers, constraint/policy/default dependencies, columns or indexes refuse.
The referenced `organizations` table does not require FORCE RLS.

[`scripts/workforce-reconciliation-schema-contract.mjs`](../scripts/workforce-reconciliation-schema-contract.mjs)
validates a maximum4096-byte stdin JSON projection, refuses unknown/nonboolean
fields and emits finite separate failed prerequisites. It accepts no database
connection, credentials, service, raw SQL override or output path. Source bindings
cover the exact migration and four supplement files. The complete migration
SHA256 remains `c452e7f6d13dca1e5257d8353c252745d05cd4f18eae83cd45501f61664ef719`.
`MATCHED_CATALOG_CONTRACT_ONLY` means the observed catalog matched this bounded
contract, not that a release, production baseline or C12 was accepted. Catalog
evidence describes one snapshot; it does not freeze administrative changes.

## Verification and provenance

[`scripts/workforce-reconciliation-schema-contract.test.mjs`](../scripts/workforce-reconciliation-schema-contract.test.mjs)
uses the complete unmodified migration on an explicitly synthetic selected-DDL
fixture. The GitHub Ubuntu24.04 workflow provisions only its disposable
PostgreSQL16 service. A fresh empty fixed-name loopback database and exact
checked-out PR head are mandatory. No complete Prisma/current-schema or
historical-migration replay is claimed. Catalog-only and tenant test roles exist
only in that disposable service; no actual grants or existing service are changed.

Tests include actual default/CHECK/FK/cascade/RLS behavior and deliberate
column/default/key/check/policy/custom-operator/trigger/index drift. Original
business-fact fingerprints and source bindings must remain unchanged at the end
of every case; rolled-back behavior probes are synthetic. Receipts retain the
precise fixture scope, source SHA/hashes, case results and limitations. First
failures and subsequent corrected or unchanged runs must be preserved separately.

Initial targeted Node run: four unit cases PASS; the hosted PG case SKIPPED
because this remote host must not run database-heavy verification. Runner policy
and whitespace check PASS. Hosted PostgreSQL and exact final CI/review are
PENDING at this entry; this is preparation, not a passed acceptance claim.
UI/browser/build: NOT RUN for this supplement because it changes no interface,
client boundary, application route, schema or build configuration. Existing C6
browser/PG/compiler evidence remains attached to its own released f308 source.

## Preserved limits and next acceptance

The real production metadata run37700706462 remains INCOMPLETE with
`APPLIED_TABLE_CONSTRAINTS_NOT_PROVED` and `DEFAULT_ACL_UNREVIEWED`.
This supplement does not reclassify that result or weaken its helper/test/gate.
The separate backup default-ACL attribution review establishes its specific
recipient's purpose; it is not a backup execution or restore drill. This new
contract has NOT RUN on an authorized actual current/restored catalog.

Full historical staging still lacks an approved reproducible baseline: the
original empty replay failed after391 migrations at
`20260811150000_zapier_webhook_api_key_provenance` (`api_keys` missing,
P3018/42P01). The existing
[schema-only baseline contract](./workforce-c12-schema-only-baseline-contract-2026-10-06.md)
defines the minimized package from one approved already restored isolated copy;
no such copy/operator/service/provenance is supplied. No guessed replacement,
edited checksum or migration marked applied.

Representative density/query-timeouts, collectors/access/retention/alerts,
scheduling/activation, physical device/pilot/load and backup/restore evidence
keep their distinct open criteria. Synthetic tests do not substitute for them.
Support and HRHub personnel-document research are untouched. Accepted accounting
stays85/161 DONE,76 open,14/15 gates,weighted61%; no new task is closed.


## Independent source corrections after the first hosted run

Original source36c0a26f9a8c40e5f5fea76c007fdc367e1112f1/run37739012389
passed35 isolated cases. Its original ZIP/receipt remains in
[evidence](./evidence/hrm-c12-schema-contract-2026-10-08/first-hosted/receipt-original.json).
This narrower pass does not accept the later corrections. Independent review
identified inheritance, descriptor-copy race, early failure retention and exact
FK-trigger binding omissions. The corrected contract forbids parent/child
inheritance, uses one cached descriptor snapshot, retains setup/admission failures
with finite diagnostics, and requires each builtin FK trigger/event/relation and
index tuple once. Two new actual drift cases cover inheritance and a deliberately
misbound internal trigger only in the owned disposable fixture. No privileged
catalog tampering resistance or production defect is claimed. Nine synthetic
business-fact table hashes are checked after every case; behavior writes roll
back. Final-source hosted execution and mandatory CI/review are pending here.


## Final-source isolated acceptance

Source10049d31ff02482085b180d2d65ab942ea1beb64/tree568bb061c4a891d3d9d268dbb7b546ead156da3c
passed actual GitHub run37739776660/job113187557841 at the exact source checkout.
Receipt37/37 schema/behavior/drift cases PASS, plus four Node unit cases PASS;
TAP reports42 including the parent container test, zero failures/skips/cancellations.
Do not count that parent as an extra behavioral case. Artifact11533336298/ZIP
SHA256e375f0929a733b409d0f7319e00892b0a7bef3c11e793cbfbae6f0d1e24b912f
CRC and all five source byte/size bindings verified. Nine before/after hashes
match; eight root tables are empty and two synthetic organization rows exist.
This is actual isolated schema enforcement, not real operating/production data.

[evidence](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/hosted-receipt-parsed.json)
and the [finite hosted summary](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/hosted-log-finite-summary.json)
retain separate case provenance and zero-skip totals. The raw synthetic job log
was read only to derive whitelisted summary/hash; no connection environment or
raw stderr is published. Its receipt and original ZIP remain immutable. GitHub
service cleanup step SUCCESS. Earlier first35-case receipt/source and original
local harness failures remain separate.

Independent source review accepts the inheritance, descriptor, receipt retention
and exact FK trigger corrections with no current P0–P3 findings. Final hosted
evidence and unchanged mandatory gates are still being reviewed at this entry.
PR631's checked merge94c42aed076efabb45fbe2a7676dec8995385c7d has the exact
same tree as the frozen source10049; source review/CI are not credited to a
future source edit. The dependent evidence branch contains documentation only.

The TAP count1 above is the parent PostgreSQL Node test group; container service
teardown is a separately successful GitHub step, not a counted test case.

The stdin validator verifies shape and local source bindings only; it cannot
authenticate a supplied JSON's database/execution origin. Actual catalog proof
requires the authorized operator, fixed-query execution and separately verified
source/connection/provenance packet. The hosted receipt above supplies its
explicit synthetic execution origin; no other input is promoted to that proof.


## Terminal mandatory checks on the frozen source

All five required GitHub App15368 contexts SUCCESS at exactsource10049:
pr-scope,static-checks,typecheck,runner-policy,scan. Actual ready-event run
37739926801 completedSUCCESS; PR631 is restoredDRAFT with no newsourcecommit.
Actual staticregression retains18failing/18baseline files; no newlyfailingfiles
and everybaselineentrystillfails. Actual compiler exits2 with1153historical
diagnostics/35families,64gatedpairs matching unchanged64baseline; both blocking
gates PASS. Neither globalcompiler nor globalsuite is claimed clean.

[Five-check proof](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/mandatory-five-exact-head.json),
[static summary](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/mandatory-static-finite-summary.json)
and [compiler summary](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/mandatory-typecheck-finite-summary.json)
retain exactsource, jobs, hashes and limits. There was no fullbuild/browser or
actualproduction/restoredcatalog run for this source-only supplement. Local
ESLint couldnotstart without installeddependency; syntax/Node/PG/mandatorygates
ran. No check is described as passed merely because another step was green.

While reviewing, main advanced externally to227e2110 throughPR630. Its eight
MTM/API/types/locale/test paths preserve these C12/C6 paths and42Workforce
translation namespaces, but wholeincoming release/integration is outside this
source acceptance. Own checked merge94c has the exact10049 tree; frozen10049
proof doesnotqualify any futureintegrationtree. Evidence is dependent draftPR632;
no newC12 merge, deployment, activation or accesschange. FullC12 constraints,
realobservations and restoredbaseline criteria listed above stay open.


Final independent [terminal review](./evidence/hrm-c12-schema-contract-2026-10-08/final-10049/independent-final-acceptance.json)
accepts this bounded source10049/isolatedPG/unchangedmandatory-gate result,
including complete64compilerpair identities/counts, immutableoriginals and85-task
accounting. It adds no newtask or C12phase credit. Fullactual/restoredcatalog,
historicalbaseline/density/operation/physical/restore criteria remain NOTRUN/open.
SourcePR631 and dependent documentationPR632 remainDRAFT/unmerged.
