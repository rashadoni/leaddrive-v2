# C12 dense operations evidence

Current source: PR589 `5f87cc94a684d5083804f0dae23116384dda24b4`, integrated main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4` after PR593. Exact remote/local 8,750-file manifest verified. Owner rerun: 123 HRM checks, 191 MTM regressions, translation parity and bounded typecheck PASS. New exact-head hosted checks and independent source acceptance are pending at this checkpoint. Production remains untouched; C12-008 PARTIAL, weighted 59%.

The previous terminal receipts below are immutable evidence for the previous head and base. They do not establish acceptance of the new integration. `final/hrm-593-owner-checkpoint.json` records the resumed work. `final/hrm-main593-migration-independent-findings-20261006.json` establishes the missing public api_keys creation/bootstrap provenance; the new source documentation records the safe next dependency.

## Previous source checkpoint

Previous code candidate: `6843cc24428a181cf80c57fe358a4944a9439ded`, sole PR589.
All five mandatory baseline gates and all six additional workflow latest outcomes are PASS. Restore required one same-head rerun: attempt 1 retained FAIL at 10/15 UI scenarios, attempt 2 completed 15/15 PASS. The first failure cause remains undetermined. The runtime remains dormant. C12-008 remains PARTIAL; weighted progress remains 59%.

The corrected immutable source acceptance is in `final/hrm-ops-independent-immutable-6843cc2-20261006.json`.
The additive schema drift and resolution receipts preserve the predecessor findings;
older ba2c source acceptance is historical and is not the final acceptance.
The new Prisma annotations describe the already-tested unchanged SQL migration.

Owner results are 123 PASS / 0 failed / 0 skipped (73 actual PostgreSQL + 50 pure).
Independent full-schema synthetic evidence is nine distinct PostgreSQL scenarios
and three pure probes. Runtime, tests and SQL were not rerun for the two-annotation
schema correction; their exact bytes were reverified. Schema validation and SQL
generation were repeated. Final hosted results are recorded separately for the
corrected exact head, with no prior-head credit.

`baseline/` describes the older 0a40 experiment. `fullschema/` contains the new dense
experiment and explicitly preserved initial harness failures. `review/` retains
owner tests, independent source history, cleanup and source bindings. The older
`root-proof.json` binds the ba2c checkpoint, not the final corrected head.

Large SQL and base-tree inputs are losslessly gzip/base64 encoded. The original
`root-proof.json` and `final/correction-evidence-index.json` specify ordered parts,
original byte counts and SHA256. Concatenate parts, decode base64, then gunzip.
Large independent remote-tree response dumps explicitly marked local-only remain
bound to immutable Git commit/tree identities and their recorded SHA256.

The historical migration chain still stops after 391 completed migrations at
`20260811150000_zapier_webhook_api_key_provenance` because `api_keys` is absent
(P3018 / SQL 42P01). Generated-schema tests are not full migration-history,
production staging, ACL/trigger, full schedule coverage, SLO or activation proof.
An approved reproducible staging baseline or separately scoped history repair is
required before those remaining acceptance checks can complete. Eligible-roster
monitoring, alert delivery and runtime activation also remain open.

Terminal owner acceptance and independent hosted receipts are in `final/`.
The next dependency-scoped plan is `final/hrm-ops-next-staging-validation.md`.
