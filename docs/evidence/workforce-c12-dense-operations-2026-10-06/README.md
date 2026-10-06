# C12 dense operations: final PR593 integration checkpoint

PR589 is the sole cumulative HRM candidate, head `5f87cc94a684d5083804f0dae23116384dda24b4`, tree `9733850bf05fce1ac451367e961ab605813f6b3f`.
Fresh main is `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`.
Synthetic `8e10365ee67e222ac222a0732c3feec33e95d329` has those two parents and exactly the candidate tree.

All five mandatory gates and all six additional checks passed on the current head; all nine workflows passed on attempt 1. The optional production build was SKIPPED. This is baseline-qualified acceptance, not proof of globally clean compiler diagnostics or the entire test suite.

## Current evidence

`integration593/hrm-593-root-terminal-acceptance.json` and
`integration593/hrm-593-independent-hosted-terminal-20261006.json`
are the final owner and independent receipts. Their supporting metadata and finite test reports are in the same directory.

Both reviews verified 8,750 source files. All 22 files brought from main, including PR591 and PR593 translations and the reduced 64-pair typecheck baseline, are preserved exactly. All 45 prior HRM paths are unchanged. The only new path is the migration investigation document, added in a separate commit. Support PR592 is untouched.

Fresh owner runs: 123/123 HRM checks (73 actual PostgreSQL + 50 pure), 191/191 MTM regressions, translation parity and bounded typecheck PASS. Independent rerun: 50 pure checks and three separate ownership probes PASS, with 73 opt-in PostgreSQL tests SKIPPED by that reviewer. No fresh independent PostgreSQL rerun or hosted credit is claimed for those 73 cases. Earlier nine independent PostgreSQL scenarios remain historical evidence for unchanged runtime bytes.

Fresh restore run 37433172745, job 112168589763, artifact 11398541186 passed on attempt 1. The safe JSON reports 15 unique cases PASS, two cleanup checks PASS and 34 exact current source bindings, including changed EN/RU/AZ dictionaries. Owner and reviewer read that finite payload. Other five workflow artifacts were metadata-only. No raw CI logs or screenshots were opened; geometry assertions do not establish visual, WCAG, native zoom or full localization acceptance.

## Historical evidence retained

The `final/` directory preserves prior head6843 terminal receipts and both restore attempts, qualified to old main0dad/synthetic10e4. That first restore attempt failed after 10/15 completed cases; its cause remains unknown. Neither its retry nor the new passing run diagnoses or erases that failure.

Earlier `baseline/`, `fullschema/` and `review/` retain initial fixture failures, schema correction and prior tests. The older root proof binds ba2c, not the current candidate. Large original SQL/base-tree inputs are losslessly encoded as specified in `root-proof.json` and `final/correction-evidence-index.json`. Some large remote metadata dumps remain local and are explicitly listed in `integration593/hrm-593-artifact-boundary.json`, bound to immutable Git identities.

## Remaining C12 acceptance

Historical clean replay stops after 391 completed migrations at `20260811150000_zapier_webhook_api_key_provenance`, missing `api_keys` (P3018 / SQL 42P01). The first public commit already has the model, but none of its 440 migrations creates the table; no creation was found among the 511 current-main migrations either. See source document `docs/workforce-c12-api-key-baseline-investigation-2026-10-06.md` and the independently bound investigation in `final/`.

The required next dependency is an authoritative schema-only staging baseline and migration ledger, or original pre-public creation DDL with provenance. No history rewrite, repair SQL, mark-applied or migration-history application was performed. A guessed table or an appended migration does not repair earlier failed replay.

The next dependency-scoped plan remains `final/hrm-ops-next-staging-validation.md`: full historical RLS/ACL/trigger and schedule coverage, representative density/churn/SLO, eligible-roster monitoring and alert delivery remain open. Current health covers tracked attempts only. No merge, deployment, production write, grant, scheduler registration or runtime activation occurred.

WF-C12-008 remains PARTIAL. Ledger unchanged: 82/161 DONE, 79 open, 14/15 gates, C8 45%, weighted 59%.
