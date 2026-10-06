# WF-C12-008 — complete-tenant reader admission

Bounded result: the dormant reconciliation tick refuses an unverified tenant
reader before scanning or advancing its cursor. WF-C12-008 remains PARTIAL.
Accounting remains 84/161 DONE, 77 open, 14/15 gates, weighted 60%; no task or
phase-gate credit is added. This is the prepared C12 successor to accepted
PR589 → PR605 (`bf6ed11f2bba8c93e828fb044315794b44224741`). PR606 remains
validation-only. No merge, deployment, scheduler or tenant activation is included.

## Reproduced product gap and correction

The original tick accepted a non-superuser, non-BYPASSRLS reader with the correct
tenant context. An additional restrictive SELECT policy could hide its actual
workday: the tick returned MATCHED with zero examined roots and advanced the
cursor. The unchanged business-fact fingerprints and exact five source bindings
are retained in [the original negative](./evidence/workforce-c12-reader-profile-2026-10-06/initial-visibility-probe.json).
This exposes a gap in whole-tenant admission; it does not rewrite earlier finite
tests whose declared precondition was a complete, trusted tenant reader.

The new [reader-profile verifier](../src/lib/workforce/reconciliation-reader-profile.ts)
runs inside the scan's read-only Repeatable Read transaction. It normalizes the
transaction-local search path to trusted namespaces and checks all 18 source and
schedule-dependency tables. It requires ordinary public tables, active forced RLS,
an effective non-owner SELECT-only role, no table/column write grants, the text
tenant column with default collation, and exactly one applicable permissive
SELECT/ALL policy in either supported canonical form. Policy dependencies are
denied except for the relation/tenant column and builtin `current_setting`;
pinned builtin objects do not normally appear in `pg_depend`.

Unknown policy expressions, additional applicable restrictive policies, custom
operators, relation shadows, missing access and changed column semantics fail
closed. `ACCESS SHARE ... NOWAIT` prevents relation/policy DDL during the snapshot
and refuses contention. Administrative role attributes and membership must remain
stable for the run; these relation locks do not freeze role administration.
Refusal returns the existing finite INCOMPLETE outcome, records the attempt and
leaves the cursor unchanged. The verifier grants no rights and changes no facts.

## Actual bounded evidence

- [Final matrix](./evidence/workforce-c12-reader-profile-2026-10-06/profile-matrix-attempt6.json):
  35/35 PASS, with before/after exact bindings for 15 files, immutable fingerprints
  for 18 fact tables, supported tenant-only and tenant-plus-bypass policies,
  18 individual hidden-table refusals, direct/PUBLIC/inherited grant checks,
  inherited and non-applicable policy distinction, temporary shadow/view/missing
  relations, custom operator and collation refusals, and actual blocked policy DDL.
- [Existing PostgreSQL regression](./evidence/workforce-c12-reader-profile-2026-10-06/existing-pg-regression-final.json):
  152/152 tests in seven files, zero skips, fresh owned databases and before/after
  source bindings. These include dense traversal, approval/export closure,
  cursor/lease/attempt fencing and roster diagnostics. Their selected-DDL fixtures
  remain separate from the full-current-schema matrix.
- [Scoped ESLint](./evidence/workforce-c12-reader-profile-2026-10-06/profile-lint-final-harness.json):
  all three changed executable files, zero errors/warnings.
- The matrix uses the locally pinned pgvector PostgreSQL 16 image, a complete
  current Prisma-generated schema, and the complete byte-bound C12 operations
  migration after replacing only its empty generated objects. It verifies nine
  valid C-collated reconciliation indexes and records operational CHECKs, relation
  column shapes and RLS flags. The 18 tenant policies are explicitly synthetic;
  historical user-trigger count is zero. Two tenants each contain one agent and
  one workday; other fact tables are empty. This is not representative density.
- Original FAILs remain: attempt1 failed before cases (cause UNKNOWN); attempt4
  passed 33 cases then failed during collation-fixture preparation with P2010.
  Its exact harness/source remain. The setup was changed to drop/recreate the
  dependent synthetic policy around ALTER COLUMN; no raw diagnostic was used to
  establish the precise PostgreSQL failure cause. Attempt5 is a changed-fixture
  success, not an unchanged retry or proof of the cause. Attempts2/3 remain 30/33
  PASS respectively and are not substituted for final source bindings. Attempt5
  passed 35 cases; final attempt6 repeats all 35 after adopting the existing
  RLS-test factory. Both original harness and receipt remain.

The initial workflow-selected Social suite also exposed a classification error
in the new harness: direct Prisma clients did not use `scripts/_rls.mjs`. The
local result was 882/883, preserved with the failed test name. The harness now
uses the existing unscoped test factory, fenced to its just-created loopback
container; its process-local test URL is restored at exit. No classifier or
shared factory was changed. Final full selected Social regression: 883/883 PASS
across 52 files, zero skips. Hosted failures remain separate metadata; their raw
logs were not read.

Reproduce the bounded matrix with
`node scripts/workforce-reconciliation-reader-profile-evidence.mjs /absolute/private/receipt.json`.
It accepts no existing database URL, creates only its own disposable loopback
container, uses the locally present image, and removes its own container, volumes
and credential file. All owned containers were removed successfully. No raw CI
logs, driver messages, screenshots, connection URLs or credentials are archived.

## Acceptance boundary and next dependency

Independent review and hosted checks are separately bound to the publication
head; local green does not claim those gates or a globally clean compiler/suite.
The prior C8 terminal archive at
[`382b6e7`](https://github.com/rashadoni/leaddrive-v2/tree/382b6e75d8de68e0ec4825aa7a2977b000674587/docs/evidence/workforce-c8-terminal-bf6-2026-10-06)
preserves its exact acceptance and original failures. This change does not borrow
C8 browser/build results as its own new-head results.

Full WF-C12-008 still needs an approved, reproducible historical staging baseline
with applicable real ACL/RLS/trigger verification, representative density and
timeouts, complete authorized control-client visibility, operational collectors,
retention and alert delivery evidence, plus separately scoped activation. The
earlier empty-history replay failure after 391 migrations at
`20260811150000_zapier_webhook_api_key_provenance` (missing `api_keys`, P3018/42P01)
is unchanged. No migration was marked applied or bypassed.

The next dependency is the existing
[schema-only baseline contract](./workforce-c12-schema-only-baseline-contract-2026-10-06.md):
read-only catalog/ledger evidence from one approved already-restored isolated copy
using an already-authorized operator. No such baseline is supplied in this
session. This is a concrete external evidence boundary, not a need for another
source wrapper. C12-003 load, C12-009 drain/rollback, real telemetry and signed
device work keep their separate acceptance criteria.
