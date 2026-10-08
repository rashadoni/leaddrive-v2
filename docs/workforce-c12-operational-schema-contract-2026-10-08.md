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
